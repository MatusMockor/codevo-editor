import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelCollectionModelTypeCandidate } from "../domain/phpFrameworkLaravel";
import type { PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import {
  bladeForeachLoopBindingsAt,
  bladeViewVariableSightingsForView,
  bladeViewVariablesForViewFromEntries,
  mergeBladeViewVariableResolvedTypes,
  parseBladeForeachCollection,
  type BladeForeachLoopBinding,
  type BladeViewDataEntry,
  type BladeViewVariableSighting,
} from "../domain/bladeViewVariables";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  bladeShortTypeName,
  editorPositionAtOffset,
} from "./bladePhpCompletionContext";

const BLADE_FOREACH_MAX_RELATION_CHAIN_LENGTH = 8;

export interface BladeViewVariableResolverDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  ensureBladeViewDataEntriesLoaded: (
    requestedRoot: string,
  ) => Promise<BladeViewDataEntry[] | null>;
  resolvePhpClassPropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
  resolvePhpDeclaredType: (source: string, typeName: string | null) => string | null;
  resolvePhpExpressionType: (
    source: string,
    position: EditorPosition,
    expression: string,
  ) => Promise<string | null>;
  workspaceRoot: string | null;
}

export interface BladeViewVariableResolver {
  collectBladeForeachLoopVariables: (
    viewName: string,
    source: string,
    offset: number,
    alreadyListed: readonly PhpLaravelViewVariable[],
  ) => Promise<PhpLaravelViewVariable[]>;
  collectBladeViewVariablesWithDisplayTypes: (
    viewName: string,
  ) => Promise<PhpLaravelViewVariable[]>;
  resolveBladeForeachElementTypeForVariable: (
    viewName: string,
    source: string,
    offset: number,
    variableName: string,
  ) => Promise<string | null>;
  resolveBladeViewVariableTypeForView: (
    viewName: string,
    variableName: string,
  ) => Promise<string | null>;
}

export function createBladeViewVariableResolver(
  dependencies: BladeViewVariableResolverDependencies,
): BladeViewVariableResolver {
  const {
    currentWorkspaceRootRef,
    ensureBladeViewDataEntriesLoaded,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    workspaceRoot,
  } = dependencies;

  const resolveBladeViewVariableSightingType = async (
    sighting: BladeViewVariableSighting,
  ): Promise<string | null> => {
    if (sighting.variable.valueExpression) {
      const expressionType = await resolvePhpExpressionType(
        sighting.source,
        editorPositionAtOffset(
          sighting.source,
          sighting.variable.valueOffset ?? sighting.source.length,
        ),
        sighting.variable.valueExpression,
      );

      if (expressionType) {
        return expressionType;
      }
    }

    return resolvePhpDeclaredType(sighting.source, sighting.variable.typeHint);
  };

  const resolveBladeViewVariableTypeForView = async (
    viewName: string,
    variableName: string,
  ): Promise<string | null> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot) {
      return null;
    }

    const entries = await ensureBladeViewDataEntriesLoaded(requestedRoot);

    if (!entries || !isRequestedRootActive()) {
      return null;
    }

    const resolvedTypes: (string | null)[] = [];

    for (const sighting of bladeViewVariableSightingsForView(
      entries,
      viewName,
      variableName,
    )) {
      resolvedTypes.push(await resolveBladeViewVariableSightingType(sighting));

      if (!isRequestedRootActive()) {
        return null;
      }
    }

    return mergeBladeViewVariableResolvedTypes(resolvedTypes);
  };

  const resolveBladeForeachRootVariableType = async (
    viewName: string,
    rootVariableName: string,
    outerLoopVariableTypes: ReadonlyMap<string, string>,
  ): Promise<string | null> => {
    const outerLoopVariableType = outerLoopVariableTypes.get(
      rootVariableName.toLowerCase(),
    );

    if (outerLoopVariableType) {
      return outerLoopVariableType;
    }

    return resolveBladeViewVariableTypeForView(viewName, `$${rootVariableName}`);
  };

  const resolveBladeForeachCollectionType = async (
    viewName: string,
    source: string,
    binding: BladeForeachLoopBinding,
    outerLoopVariableTypes: ReadonlyMap<string, string>,
  ): Promise<string | null> => {
    const collection = parseBladeForeachCollection(binding.collectionExpression);

    if (!collection) {
      return null;
    }

    const rootType = await resolveBladeForeachRootVariableType(
      viewName,
      collection.rootVariableName,
      outerLoopVariableTypes,
    );

    if (!rootType) {
      return null;
    }

    if (collection.relationNames.length === 0) {
      return phpLaravelCollectionModelTypeCandidate(source, rootType);
    }

    if (collection.relationNames.length > BLADE_FOREACH_MAX_RELATION_CHAIN_LENGTH) {
      return null;
    }

    let ownerType: string | null = rootType;

    for (let index = 0; index < collection.relationNames.length; index += 1) {
      const isFinalRelation = index === collection.relationNames.length - 1;
      ownerType = await resolvePhpClassPropertyOrRelationType(
        ownerType,
        collection.relationNames[index],
        isFinalRelation,
      );

      if (!ownerType) {
        return null;
      }
    }

    return ownerType;
  };

  const resolveBladeForeachLoopVariableTypes = async (
    viewName: string,
    source: string,
    offset: number,
  ): Promise<Map<string, string>> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const resolvedTypes = new Map<string, string>();

    for (const binding of bladeForeachLoopBindingsAt(source, offset)) {
      const elementType = await resolveBladeForeachCollectionType(
        viewName,
        source,
        binding,
        resolvedTypes,
      );

      if (!isRequestedRootActive()) {
        return new Map();
      }

      if (elementType) {
        resolvedTypes.set(binding.loopVariableName.toLowerCase(), elementType);
      }
    }

    return resolvedTypes;
  };

  const resolveBladeForeachElementTypeForVariable = async (
    viewName: string,
    source: string,
    offset: number,
    variableName: string,
  ): Promise<string | null> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const normalizedName = variableName.replace(/^\$/, "").toLowerCase();
    const loopVariableTypes = await resolveBladeForeachLoopVariableTypes(
      viewName,
      source,
      offset,
    );

    if (!isRequestedRootActive()) {
      return null;
    }

    return loopVariableTypes.get(normalizedName) ?? null;
  };

  const collectBladeViewVariables = async (
    viewName: string,
  ): Promise<PhpLaravelViewVariable[]> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot) {
      return [];
    }

    const entries = await ensureBladeViewDataEntriesLoaded(requestedRoot);

    if (!entries || !isRequestedRootActive()) {
      return [];
    }

    return bladeViewVariablesForViewFromEntries(entries, viewName);
  };

  const collectBladeForeachLoopVariables = async (
    viewName: string,
    source: string,
    offset: number,
    alreadyListed: readonly PhpLaravelViewVariable[],
  ): Promise<PhpLaravelViewVariable[]> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const bindings = bladeForeachLoopBindingsAt(source, offset);
    const listedNames = new Set(
      alreadyListed.map((variable) => variable.name.toLowerCase()),
    );
    const loopVariables: PhpLaravelViewVariable[] = [];
    const seenNames = new Set<string>();

    for (const binding of bindings) {
      const name = `$${binding.loopVariableName}`;
      const key = name.toLowerCase();

      if (listedNames.has(key) || seenNames.has(key)) {
        continue;
      }

      seenNames.add(key);

      const elementType = await resolveBladeForeachElementTypeForVariable(
        viewName,
        source,
        offset,
        binding.loopVariableName,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      loopVariables.push({
        detail: "foreach item",
        name,
        typeHint: bladeShortTypeName(elementType),
        valueExpression: null,
        valueOffset: null,
      });
    }

    return loopVariables;
  };

  const collectBladeViewVariablesWithDisplayTypes = async (
    viewName: string,
  ): Promise<PhpLaravelViewVariable[]> => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const variables = await collectBladeViewVariables(viewName);

    if (!isRequestedRootActive()) {
      return [];
    }

    const enriched: PhpLaravelViewVariable[] = [];

    for (const variable of variables) {
      if (variable.typeHint) {
        enriched.push(variable);
        continue;
      }

      const resolvedType = await resolveBladeViewVariableTypeForView(
        viewName,
        variable.name,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      enriched.push({
        ...variable,
        typeHint: bladeShortTypeName(resolvedType) ?? variable.typeHint,
      });
    }

    return enriched;
  };

  return {
    collectBladeForeachLoopVariables,
    collectBladeViewVariablesWithDisplayTypes,
    resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView,
  };
}
