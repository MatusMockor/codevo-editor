export async function mapWithBoundedConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<ReadonlyArray<R>> {
  const results = new Array<R>(items.length);
  const bounded = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const workers = Math.max(1, Math.min(bounded, items.length));
  let cursor = 0;
  const drain = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: workers }, drain));
  return results;
}
