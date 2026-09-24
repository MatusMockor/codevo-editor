export function withBoundedEntry<V>(
  current: ReadonlyMap<string, V>,
  key: string,
  value: V | null,
  limit: number,
): ReadonlyMap<string, V> {
  const next = new Map(current);
  next.delete(key);
  if (value !== null) next.set(key, value);
  for (const oldest of next.keys()) {
    if (next.size <= limit) break;
    next.delete(oldest);
  }
  return next;
}
