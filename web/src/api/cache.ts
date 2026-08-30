interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export interface CacheOptions {
  /** Age below this → served from cache, no network. */
  freshTtl: number;
  /** Age below this → served from cache + background refresh; above → sync fetch. */
  staleTtl: number;
}

function ageMs(key: string): number {
  const e = store.get(key);
  return e ? Date.now() - e.fetchedAt : Number.POSITIVE_INFINITY;
}

/** Shared 3-level data cache: fresh → cache; stale → cache + background
 *  refresh (failures keep stale silently); expired/miss → sync fetch. */
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CacheOptions,
): Promise<T> {
  const age = ageMs(key);
  if (age < opts.freshTtl) {
    return store.get(key)!.value as T;
  }
  if (age < opts.staleTtl) {
    // stale: serve cache now, refresh in background (fire-and-forget)
    void refresh(key, fetcher);
    return store.get(key)!.value as T;
  }
  // expired or miss: sync fetch
  const fresh = await fetchOne(key, fetcher);
  store.set(key, { value: fresh, fetchedAt: Date.now() });
  return fresh;
}

async function fetchOne<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  let p: Promise<T>;
  try {
    p = Promise.resolve(fetcher());
  } catch (e) {
    return Promise.reject(e); // synchronous throw → reject without polluting inflight
  }
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

async function refresh<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  try {
    const value = await fetchOne(key, fetcher);
    store.set(key, { value, fetchedAt: Date.now() });
  } catch (e) {
    // Background refresh failure: keep stale data, never surface an alert.
    console.debug('[cache] background refresh failed', key, e);
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  store.clear();
}
