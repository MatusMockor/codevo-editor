export function adjacentThreadId(
  ordered: ReadonlyArray<string>,
  current: string | null,
  step: 1 | -1,
): string | null {
  if (ordered.length === 0) return null;
  const index = current === null ? -1 : ordered.indexOf(current);
  if (index === -1)
    return step === 1 ? (ordered[0] ?? null) : (ordered[ordered.length - 1] ?? null);
  return ordered[(index + step + ordered.length) % ordered.length] ?? null;
}
