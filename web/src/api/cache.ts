interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  /** Cache generation that wrote this entry. Bumped by every clearCache(). */
  gen: number;
}

// Auth/cache epoch ownership (reviewer A): every flight and entry is scoped to
// the generation captured at request start. clearCache() (logout / session
// wipe) advances the generation; an A-era success that resolves after the wipe
// must never populate the store, and a B-era request must never join an
// orphaned A-era flight or receive A data. Minimal cohesive design: a single
// monotonic counter + gen checks at join/write + identity-guarded flight
// cleanup (old finally cannot clear a new flight for the same key).
let cacheGeneration = 0;

/** Current cache generation (monotonic; bumped by every clearCache()). */
export function getCacheGeneration(): number {
  return cacheGeneration;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, { gen: number; promise: Promise<unknown> }>();

export interface CacheOptions {
  /** Age below this → served from cache, no network. */
  freshTtl: number;
  /** Age below this → served from cache + background refresh; above → sync fetch. */
  staleTtl: number;
}

/** Shared 3-level data cache: fresh → cache; stale → cache + background
 *  refresh (failures keep stale silently); expired/miss → sync fetch.
 *  Generation-scoped: the calling generation is captured on entry; a wipe
 *  that crosses an in-flight fetch orphans it (no join, no write). */
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CacheOptions,
): Promise<T> {
  const genAtStart = cacheGeneration;
  const entry = store.get(key);
  // Only serve entries written in the CURRENT generation. (clearCache() clears
  // the map, so a cross-generation entry should not exist; the gen check is
  // defense-in-depth against a write that slipped the post-fetch guard.)
  if (entry && entry.gen === genAtStart) {
    const age = Date.now() - entry.fetchedAt;
    if (age < opts.freshTtl) {
      return entry.value as T;
    }
    if (age < opts.staleTtl) {
      // stale: serve cache now, refresh in background (fire-and-forget)
      void refresh(key, fetcher, genAtStart);
      return entry.value as T;
    }
  }
  // expired, miss, or stale-generation entry: sync fetch
  const fresh = await fetchOne(key, fetcher, genAtStart);
  // A wipe that crossed this fetch orphans the result: return it to the
  // original waiter but never populate the store with pre-wipe data.
  if (genAtStart === cacheGeneration) {
    store.set(key, { value: fresh, fetchedAt: Date.now(), gen: genAtStart });
  }
  return fresh;
}

async function fetchOne<T>(key: string, fetcher: () => Promise<T>, gen: number): Promise<T> {
  const existing = inflight.get(key);
  // Join ONLY same-generation flights. A B-era request arriving while an
  // orphaned A-era flight is pending starts its OWN fetch (overwrites the map
  // slot); the orphaned flight's guarded finally below cannot clear it.
  if (existing && existing.gen === gen) return existing.promise as Promise<T>;
  let p: Promise<T>;
  try {
    p = Promise.resolve(fetcher());
  } catch (e) {
    return Promise.reject(e); // synchronous throw → reject without polluting inflight
  }
  const record = { gen, promise: p as Promise<unknown> };
  inflight.set(key, record);
  try {
    return await p;
  } finally {
    // Identity-guarded cleanup: an orphaned A-era finally must never clear a
    // newer B-era flight stored under the same key.
    if (inflight.get(key) === record) inflight.delete(key);
  }
}

async function refresh<T>(key: string, fetcher: () => Promise<T>, gen: number): Promise<void> {
  try {
    const value = await fetchOne(key, fetcher, gen);
    // A wipe that crossed the background flight orphans the value.
    if (gen !== cacheGeneration) return;
    store.set(key, { value, fetchedAt: Date.now(), gen });
  } catch (e) {
    // Background refresh failure: keep stale data, never surface an alert.
    console.debug('[cache] background refresh failed', key, e);
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  cacheGeneration += 1;
  store.clear();
  // inflight is intentionally NOT cleared: orphaned A-era flights stay in the
  // map with their old gen until they settle. B-era requests ignore them (gen
  // mismatch) and overwrite the slot; the orphaned finally is identity-guarded
  // and cannot delete the newer flight.
}
