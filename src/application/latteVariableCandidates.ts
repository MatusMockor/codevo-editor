import {
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  type LatteVariableDeclaration,
} from "../domain/latteSyntax";
import type { PhpFrameworkViewDataVariable } from "../domain/phpFrameworkProviders";
import {
  parseLatteBlockSyntax,
  type LatteBlockDefinition,
  type LatteBlockSyntaxDocument,
} from "../domain/latteBlockSyntax";
import { resolveLatteBlockArgumentType } from "./latteBlockArgumentTypes";
import type { NetteViewDataEntry } from "./netteViewDataEntries";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import { mergeLatteResolvedTypes } from "./latteTemplateTypeResolution";
import type { LatteVariableResolutionContext } from "./latteVariableContracts";

export interface LatteVariableCandidate {
  detail: string;
  name: string;
  typeHint: string | null;
}

const NETTE_TEMPLATE_IMPLICIT_VARIABLES = [
  {
    detail: "Nette template context",
    name: "$presenter",
    typeHint: "Presenter",
  },
  {
    detail: "Nette template context",
    name: "$control",
    typeHint: "Control",
  },
] satisfies LatteVariableCandidate[];

/**
 * Gathers the in-scope template variables for the `{$}` list, first sighting of
 * a name wins: inline declarations > template type > foreach > include
 * arguments > implicit context > presenter/control view-data.
 */
export async function collectLatteVariableCandidates(
  context: LatteVariableResolutionContext,
  source: string,
  offset: number,
): Promise<LatteVariableCandidate[]> {
  const { isRequestedRootActive } = context;
  const byName = new Map<string, LatteVariableCandidate>();
  const add = (name: string, detail: string, typeHint: string | null) => {
    if (byName.has(name)) {
      return;
    }

    byName.set(name, { detail, name, typeHint });
  };
  const replace = (name: string, detail: string, typeHint: string | null) => {
    byName.set(name, { detail, name, typeHint });
  };
  const blockSyntax = parseLatteBlockSyntax(source);
  const definition = innermostDefineAt(blockSyntax, offset);

  if (definition) {
    for (const parameter of definition.parameters) {
      const resolution = await resolveLatteBlockArgumentType(
        source,
        offset,
        parameter.name,
        {
          isRequestedRootActive,
          resolveExpressionType: (expression, expressionOffset) =>
            context.resolveExpressionTypeAt?.(
              source,
              expression,
              expressionOffset,
              0,
            ) ?? Promise.resolve(null),
        },
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      add(
        `$${parameter.name}`,
        "define parameter",
        shortTypeName(resolution.type),
      );
    }
  }

  for (const declaration of latteVariableDeclarations(source)) {
    if (
      !declaration.variableName ||
      !isLatteDeclarationVisibleAt(declaration, offset)
    ) {
      continue;
    }

    if (!declarationBelongsToDefinition(blockSyntax, declaration.offset, definition)) {
      continue;
    }

    const declaredType =
      declaration.kind === "varType" || declaration.kind === "parameters"
        ? declaration.typeName
        : null;

    replace(
      `$${declaration.variableName}`,
      `template ${declaration.kind}`,
      shortTypeName(declaredType),
    );
  }

  if (definition) {
    addForeachCandidates(source, offset, replace);
    return Array.from(byName.values());
  }

  for (const sighting of await context.loadTemplateTypePropertySightings(source)) {
    if (!isRequestedRootActive()) {
      return [];
    }

    add(
      sighting.property.name,
      "template type",
      shortTypeName(sighting.property.type),
    );
  }

  addForeachCandidates(source, offset, add);

  const includedArguments = await loadIncludedArguments(context);

  if (!isRequestedRootActive()) {
    return [];
  }

  const includedTypesByName = new Map<string, (string | null)[]>();

  for (const argument of includedArguments) {
    const types = includedTypesByName.get(argument.name) ?? [];
    types.push(argument.type);
    includedTypesByName.set(argument.name, types);
  }

  for (const [name, types] of includedTypesByName) {
    add(
      `$${name}`,
      "include argument",
      shortTypeName(mergeLatteResolvedTypes(types)),
    );
  }

  for (const variable of NETTE_TEMPLATE_IMPLICIT_VARIABLES) {
    add(variable.name, variable.detail, variable.typeHint);
  }

  const entries = await context.loadViewDataEntries();

  if (!isRequestedRootActive()) {
    return [];
  }

  const viewNames = await context.viewNames();

  if (!isRequestedRootActive()) {
    return [];
  }

  for (const variable of netteViewDataVariablesForViews(entries, viewNames)) {
    add(variable.name, "presenter data", shortTypeName(variable.typeHint));
  }

  return Array.from(byName.values());
}

function addForeachCandidates(
  source: string,
  offset: number,
  add: (name: string, detail: string, typeHint: string | null) => void,
): void {
  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    add(`$${binding.loopVariableName}`, "foreach item", null);

    if (binding.keyVariableName) {
      add(`$${binding.keyVariableName}`, "foreach key", null);
    }
  }
}

function innermostDefineAt(
  syntax: LatteBlockSyntaxDocument,
  offset: number,
): LatteBlockDefinition | null {
  let innermost: LatteBlockDefinition | null = null;

  for (const definition of syntax.definitions) {
    if (definition.kind !== "define") {
      continue;
    }

    if (offset < definition.bodySpan.start || offset > definition.bodySpan.end) {
      continue;
    }

    if (!innermost || definition.bodySpan.start >= innermost.bodySpan.start) {
      innermost = definition;
    }
  }

  return innermost;
}

function declarationBelongsToDefinition(
  syntax: LatteBlockSyntaxDocument,
  declarationOffset: number,
  definition: LatteBlockDefinition | null,
): boolean {
  return innermostDefineAt(syntax, declarationOffset) === definition;
}

interface IncludeAwareVariableContext {
  currentTemplateRelativePath: string;
  loadIncludedTemplateArguments(
    targetRelativePath: string,
  ): Promise<readonly NetteIncludedTemplateArgument[]>;
}

function loadIncludedArguments(
  context: LatteVariableResolutionContext,
): Promise<readonly NetteIncludedTemplateArgument[]> {
  const includeContext = context as LatteVariableResolutionContext &
    Partial<IncludeAwareVariableContext>;

  if (
    !includeContext.currentTemplateRelativePath ||
    !includeContext.loadIncludedTemplateArguments
  ) {
    return Promise.resolve([]);
  }

  return includeContext.loadIncludedTemplateArguments(
    includeContext.currentTemplateRelativePath,
  );
}

export function isLatteDeclarationVisibleAt(
  declaration: LatteVariableDeclaration,
  offset: number,
): boolean {
  if (declaration.kind !== "var" && declaration.kind !== "default") {
    return true;
  }

  return declaration.offset < offset;
}

export function netteViewDataVariablesForViews(
  entries: readonly NetteViewDataEntry[],
  viewNames: readonly string[],
): PhpFrameworkViewDataVariable[] {
  const variables: PhpFrameworkViewDataVariable[] = [];

  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      variables.push(...binding.variables);
    }
  }

  return variables;
}

export function shortTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const baseType = typeName.split("<")[0] ?? typeName;
  const segments = baseType.replace(/^\\+/, "").split("\\");
  const shortName = segments[segments.length - 1]?.trim() ?? "";

  return shortName.length > 0 ? shortName : null;
}

function matchesLatteViewName(
  bindingViewName: string,
  candidateViewNames: readonly string[],
): boolean {
  return candidateViewNames.includes(bindingViewName);
}
