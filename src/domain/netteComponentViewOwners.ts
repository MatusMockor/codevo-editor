import { shortPhpTypeName } from "./phpTypes";

export function netteComponentViewOwnerNameFromType(
  typeName: string | null,
): string | null {
  const shortName = shortPhpTypeName(typeName);

  if (!shortName) {
    return null;
  }

  for (const suffix of ["Control", "Component", "Widget"]) {
    if (shortName.endsWith(suffix) && shortName.length > suffix.length) {
      return shortName.slice(0, -suffix.length);
    }
  }

  return null;
}
