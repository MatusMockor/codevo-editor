export function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  );
}

export function nullableInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}
