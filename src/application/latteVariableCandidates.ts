import {
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  type LatteVariableDeclaration,
} from "../domain/latteSyntax";
import type { PhpFrameworkViewDataVariable } from "../domain/phpFrameworkProviders";
import type { NetteViewDataEntry } from "./netteViewDataEntries";
import type { LatteVariableResolutionContext } from "./latteVariableTypes";

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
 * a name wins: inline declarations > template type > foreach > implicit
 * context > presenter/control view-data.
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

  for (const declaration of latteVariableDeclarations(source)) {
    if (
      !declaration.variableName ||
      !isLatteDeclarationVisibleAt(declaration, offset)
    ) {
      continue;
    }

    const declaredType =
      declaration.kind === "varType" || declaration.kind === "parameters"
        ? declaration.typeName
        : null;

    add(
      `$${declaration.variableName}`,
      `template ${declaration.kind}`,
      shortTypeName(declaredType),
    );
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

  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    add(`$${binding.loopVariableName}`, "foreach item", null);

    if (binding.keyVariableName) {
      add(`$${binding.keyVariableName}`, "foreach key", null);
    }
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
