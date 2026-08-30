// backend/src/common/map-with-concurrency.ts
/**
 * Bounded-concurrency map: runs `fn` over `items` with at most `limit`
 * promises in flight. The result is index-aligned with `items` (order
 * preserved). The first rejection propagates (Promise.all semantics) — no
 * partial success. Empty items resolve `[]` without invoking `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 0) throw new Error('mapWithConcurrency: limit must be >= 1');
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
