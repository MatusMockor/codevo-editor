import { latteVariableDeclarations } from "../domain/latteSyntax";
import {
  loadNetteTemplateTypeProperties,
} from "./netteTemplateTypeDiscovery";
import type {
  LatteTemplateTypeContext,
  LatteTemplateTypePropertySighting,
} from "./netteTemplateTypeDiscovery";
import {
  latteResolvedTypeFromTemplateSightings,
} from "./latteTemplateTypeResolution";

export {
  loadNetteTemplateTypeProperties,
} from "./netteTemplateTypeDiscovery";
export {
  mergeLatteResolvedTypes,
} from "./latteTemplateTypeResolution";
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
  const sightings = await latteTemplateTypePropertySightings(context, source);

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return latteResolvedTypeFromTemplateSightings(context.deps, sightings, variableName);
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
