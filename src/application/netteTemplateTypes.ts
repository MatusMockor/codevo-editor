import { latteVariableDeclarations } from "../domain/latteSyntax";
import {
  loadNetteTemplateTypeProperties,
} from "./netteTemplateTypeDiscovery";
import type {
  LatteTemplateTypeContext,
  LatteTemplateTypePropertySighting,
} from "./netteTemplateTypeDiscovery";

export {
  loadNetteTemplateTypeProperties,
} from "./netteTemplateTypeDiscovery";
export type {
  LatteTemplateTypeCache,
  LatteTemplateTypeCacheEntry,
  LatteTemplateTypeContext,
  LatteTemplateTypeInFlight,
  LatteTemplateTypePropertySighting,
  NetteTemplateTypeDependencies,
  NetteTemplateTypeSearchResult,
} from "./netteTemplateTypeDiscovery";

export async function latteTemplateTypeVariableType(
  context: LatteTemplateTypeContext,
  source: string,
  variableName: string,
): Promise<string | null> {
  const target = `$${variableName}`;
  const sightings = await latteTemplateTypePropertySightings(context, source);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  const resolved: (string | null)[] = [];

  for (const sighting of sightings) {
    if (sighting.property.name !== target) {
      continue;
    }

    resolved.push(
      context.deps.resolveDeclaredType(
        sighting.source,
        sighting.property.type,
      ) ?? sighting.property.type,
    );
  }

  return mergeLatteResolvedTypes(resolved);
}

export async function latteTemplateTypePropertySightings(
  context: LatteTemplateTypeContext,
  source: string,
): Promise<LatteTemplateTypePropertySighting[]> {
  const typeNames = latteTemplateTypeNames(source);

  if (typeNames.length === 0) {
    return [];
  }

  const sightings: LatteTemplateTypePropertySighting[] = [];

  for (const typeName of typeNames) {
    sightings.push(...(await loadNetteTemplateTypeProperties(context, typeName)));

    if (!context.isRequestedRootActive()) {
      return [];
    }
  }

  return sightings;
}

export function latteTemplateTypeNames(source: string): string[] {
  const names = new Set<string>();

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "templateType" || !declaration.typeName) {
      continue;
    }

    names.add(declaration.typeName);
  }

  return Array.from(names);
}

export function mergeLatteResolvedTypes(
  types: readonly (string | null)[],
): string | null {
  const resolved = types.filter((type): type is string => Boolean(type));

  if (resolved.length === 0) {
    return null;
  }

  const first = resolved[0] ?? "";
  const normalize = (type: string) =>
    type.trim().replace(/^\\+/, "").toLowerCase();

  return resolved.every((type) => normalize(type) === normalize(first))
    ? first
    : null;
}
