export function normalizePhpTypeName(typeName: string): string {
  return typeName.trim().replace(/^\\+/, "").toLowerCase();
}

export function phpTypeNamesEqual(left: string, right: string): boolean {
  return normalizePhpTypeName(left) === normalizePhpTypeName(right);
}

export function shortPhpTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const normalized = typeName.replace(/^\?/, "").replace(/^\\+/, "");
  const parts = normalized.split("\\").filter(Boolean);

  return parts[parts.length - 1] ?? normalized;
}
