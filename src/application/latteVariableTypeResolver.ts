import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  parseLatteForeachCollection,
} from "../domain/latteSyntax";
import type { PhpFrameworkViewDataVariable } from "../domain/phpFrameworkProviders";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import {
  latteResolvedTypeFromTemplateSightings,
  mergeLatteResolvedTypes,
} from "./latteTemplateTypeResolution";
import {
  isLatteDeclarationVisibleAt,
  netteViewDataVariablesForViews,
} from "./latteVariableCandidates";
import type {
  LatteVariableResolutionContext,
  LatteVariableTypeDependencies,
} from "./latteVariableContracts";

const NETTE_TEMPLATE_IMPLICIT_CONTROL_TYPE = "Nette\\Application\\UI\\Control";

/**
 * Resolves the receiver type of a Latte variable through the PhpStorm-like
 * priority chain: inline type, template type, local expression, foreach item,
 * include argument, implicit presenter/control, presenter view-data.
 */
export async function resolveLatteVariableType(
  context: LatteVariableResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth = 0,
): Promise<string | null> {
  const { isRequestedRootActive, maxTypeResolutionDepth } = context;

  if (depth > maxTypeResolutionDepth) {
    return null;
  }

  const declaredType = latteDeclaredVariableType(source, variableName);

  if (declaredType) {
    return declaredType;
  }

  const templateType = await latteTemplateTypeVariableType(
    context,
    source,
    variableName,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (templateType) {
    return templateType;
  }

  const localType = await latteLocalVariableType(
    context,
    source,
    offset,
    variableName,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (localType) {
    return localType;
  }

  const foreachType = await latteForeachVariableType(
    context,
    source,
    offset,
    variableName,
    depth,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (foreachType) {
    return foreachType;
  }

  const includeResolution = await latteIncludedArgumentType(
    context,
    variableName,
    depth,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (includeResolution.found) {
    return includeResolution.type;
  }

  const implicitType = await latteImplicitVariableType(context, variableName);

  if (!isRequestedRootActive()) {
    return null;
  }

  if (implicitType) {
    return implicitType;
  }

  const presenterType = await lattePresenterVariableType(context, variableName);

  if (!isRequestedRootActive()) {
    return null;
  }

  if (presenterType) {
    return presenterType;
  }

  return null;
}

interface IncludeAwareVariableContext {
  currentTemplateRelativePath: string;
  loadIncludedTemplateArguments(
    targetRelativePath: string,
  ): Promise<readonly NetteIncludedTemplateArgument[]>;
}

async function latteIncludedArgumentType(
  context: LatteVariableResolutionContext,
  variableName: string,
  depth: number,
): Promise<{ found: boolean; type: string | null }> {
  if (depth >= context.maxTypeResolutionDepth) {
    return { found: false, type: null };
  }

  const includeContext = context as LatteVariableResolutionContext &
    Partial<IncludeAwareVariableContext>;

  if (
    !includeContext.currentTemplateRelativePath ||
    !includeContext.loadIncludedTemplateArguments
  ) {
    return { found: false, type: null };
  }

  const argumentsForTemplate = await includeContext.loadIncludedTemplateArguments(
    includeContext.currentTemplateRelativePath,
  );

  if (!context.isRequestedRootActive()) {
    return { found: false, type: null };
  }

  const matchingArguments = argumentsForTemplate.filter(
    (argument) => argument.name === variableName,
  );

  if (matchingArguments.length === 0) {
    return { found: false, type: null };
  }

  return {
    found: true,
    type: mergeLatteResolvedTypes(
      matchingArguments.map((argument) => argument.type),
    ),
  };
}

function latteDeclaredVariableType(
  source: string,
  variableName: string,
): string | null {
  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "varType" && declaration.kind !== "parameters") {
      continue;
    }

    if (declaration.variableName === variableName && declaration.typeName) {
      return declaration.typeName;
    }
  }

  return null;
}

async function latteTemplateTypeVariableType(
  context: LatteVariableResolutionContext,
  source: string,
  variableName: string,
): Promise<string | null> {
  const sightings = await context.loadTemplateTypePropertySightings(source);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return latteResolvedTypeFromTemplateSightings(
    context.deps,
    sightings,
    variableName,
  );
}

async function latteLocalVariableType(
  context: LatteVariableResolutionContext,
  source: string,
  offset: number,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "var" && declaration.kind !== "default") {
      continue;
    }

    if (!isLatteDeclarationVisibleAt(declaration, offset)) {
      continue;
    }

    if (declaration.variableName !== variableName || !declaration.expression) {
      continue;
    }

    const document = `<?php\n${declaration.expression};\n`;
    const type = await deps.resolveExpressionType(
      document,
      editorPositionAtOffset(document, document.length),
      declaration.expression,
    );

    if (!isRequestedRootActive()) {
      return null;
    }

    if (type) {
      return type;
    }
  }

  return null;
}

async function latteImplicitVariableType(
  context: LatteVariableResolutionContext,
  variableName: string,
): Promise<string | null> {
  if (variableName === "control") {
    return (
      (await context.currentControlClassName()) ??
      NETTE_TEMPLATE_IMPLICIT_CONTROL_TYPE
    );
  }

  if (variableName !== "presenter") {
    return null;
  }

  return context.currentPresenterClassName();
}

async function lattePresenterVariableType(
  context: LatteVariableResolutionContext,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;
  const entries = await context.loadViewDataEntries();

  if (!isRequestedRootActive() || entries.length === 0) {
    return null;
  }

  const viewNames = await context.viewNames();

  if (!isRequestedRootActive()) {
    return null;
  }

  const target = `$${variableName}`;
  const sightings: Array<{
    source: string;
    variable: PhpFrameworkViewDataVariable;
  }> = [];

  for (const entry of entries) {
    for (const variable of netteViewDataVariablesForViews([entry], viewNames)) {
      if (variable.name === target) {
        sightings.push({ source: entry.source, variable });
      }
    }
  }

  if (sightings.length === 0) {
    return null;
  }

  const resolved: (string | null)[] = [];

  for (const sighting of sightings) {
    resolved.push(await resolveNetteSightingType(deps, sighting));

    if (!isRequestedRootActive()) {
      return null;
    }
  }

  return mergeLatteResolvedTypes(resolved);
}

async function latteForeachVariableType(
  context: LatteVariableResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth: number,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;
  let collectionExpression: string | null = null;

  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    if (binding.loopVariableName === variableName) {
      collectionExpression = binding.collectionExpression;
    }
  }

  if (collectionExpression === null) {
    return null;
  }

  const collection = parseLatteForeachCollection(collectionExpression);

  if (!collection || collection.rootVariableName === variableName) {
    return null;
  }

  const rootType = await resolveLatteVariableType(
    context,
    source,
    offset,
    collection.rootVariableName,
    depth + 1,
  );

  if (!isRequestedRootActive() || !rootType) {
    return null;
  }

  if (collection.relationNames.length === 0) {
    return (
      extractLatteElementType(rootType) ??
      resolveLatteIterableObjectElementType(
        context,
        rootType,
        collection.rootVariableName,
      )
    );
  }

  const chainExpression = `$${collection.rootVariableName}${collection.relationNames
    .map((relation) => `->${relation}`)
    .join("")}`;
  const document = `<?php\n/** @var \\${rootType.replace(/^\\+/, "")} $${
    collection.rootVariableName
  } */\n${chainExpression};\n`;
  const chainType = await deps.resolveExpressionType(
    document,
    editorPositionAtOffset(document, document.length),
    chainExpression,
  );

  if (!isRequestedRootActive() || !chainType) {
    return null;
  }

  return extractLatteElementType(chainType);
}

async function resolveLatteIterableObjectElementType(
  context: LatteVariableResolutionContext,
  rootType: string,
  rootVariableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;

  if (!rootType.trim()) {
    return null;
  }

  for (const methodName of ["current", "fetch"]) {
    const expression = `$${rootVariableName}->${methodName}()`;
    const document = `<?php\n/** @var \\${rootType.replace(/^\\+/, "")} $${rootVariableName} */\n${expression};\n`;
    const methodType = await deps.resolveExpressionType(
      document,
      editorPositionAtOffset(document, document.length),
      expression,
    );

    if (!isRequestedRootActive()) {
      return null;
    }

    const elementType = firstUsefulLatteUnionType(methodType);

    if (elementType) {
      return elementType;
    }
  }

  return null;
}

async function resolveNetteSightingType(
  deps: LatteVariableTypeDependencies,
  sighting: {
    source: string;
    variable: PhpFrameworkViewDataVariable;
  },
): Promise<string | null> {
  const { source, variable } = sighting;

  if (variable.valueExpression) {
    const expressionType = await deps.resolveExpressionType(
      source,
      editorPositionAtOffset(
        source,
        variable.valueOffset ?? source.length,
      ),
      variable.valueExpression,
    );

    if (expressionType) {
      return expressionType;
    }
  }

  return deps.resolveDeclaredType(source, variable.typeHint);
}

/**
 * The element type of a collection type: `X[]` -> `X`, a generic
 * `iterable<X>` / `Collection<int, X>` -> its last type argument.
 */
export function extractLatteElementType(collectionType: string): string | null {
  const trimmed = collectionType.trim();

  if (trimmed.endsWith("[]")) {
    const element = trimmed.slice(0, -2).trim();

    return element.length > 0 ? element : null;
  }

  const angleStart = trimmed.indexOf("<");

  if (angleStart < 0 || !trimmed.endsWith(">")) {
    return null;
  }

  const args = splitTopLevelTypeArguments(trimmed.slice(angleStart + 1, -1));
  const last = args[args.length - 1]?.trim() ?? "";

  return last.length > 0 ? last : null;
}

function firstUsefulLatteUnionType(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  for (const part of splitTopLevelUnionTypes(typeName)) {
    const normalized = part.trim().replace(/^\?/, "");

    if (!isLatteNullOrBooleanType(normalized)) {
      return normalized;
    }
  }

  return null;
}

function splitTopLevelUnionTypes(typeName: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < typeName.length; index += 1) {
    const character = typeName[index];

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "|" && depth === 0) {
      parts.push(typeName.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(typeName.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function isLatteNullOrBooleanType(typeName: string): boolean {
  const normalized = typeName.replace(/^\\+/, "").toLowerCase();

  return (
    normalized === "null" ||
    normalized === "false" ||
    normalized === "true" ||
    normalized === "bool" ||
    normalized === "boolean"
  );
}

function splitTopLevelTypeArguments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(inner.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
