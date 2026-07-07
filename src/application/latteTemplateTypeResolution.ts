import type { NetteTemplateTypeDependencies } from "./netteTemplateTypeDiscovery";
import type { LatteTemplateTypePropertySighting } from "./netteTemplateTypeDiscovery";

export function latteResolvedTypeFromTemplateSightings(
  deps: Pick<NetteTemplateTypeDependencies, "resolveDeclaredType">,
  sightings: readonly LatteTemplateTypePropertySighting[],
  variableName: string,
): string | null {
  const target = `$${variableName}`;
  const resolved: (string | null)[] = [];

  for (const sighting of sightings) {
    if (sighting.property.name !== target) {
      continue;
    }

    resolved.push(
      deps.resolveDeclaredType(
        sighting.source,
        sighting.property.type,
      ) ?? sighting.property.type,
    );
  }

  return mergeLatteResolvedTypes(resolved);
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
