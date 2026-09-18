interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  /** Cache generation that wrote this entry. Bumped by every clearCache(). */
  gen: number;
}

// Auth/cache epoch ownership (reviewer A): every flight and entry is scoped to
// the generation captured at request start. clearCache() (logout / session
// wipe) advances the generation; an A-era fetch that resolves after the wipe
// is ORPHANED — its waiter REJECTS with CacheStaleError (never receives
// pre-wipe A data) and nothing is written. A B-era request never joins an
// orphaned A-era flight and never receives A data. Minimal cohesive design: a
// single monotonic counter + gen checks at join/settle + identity-guarded
// flight cleanup (old finally cannot clear a new flight for the same key).
let cacheGeneration = 0;
const keyGeneration = new Map<string, number>();

/** Current cache generation (monotonic; bumped by every clearCache()). */
export function getCacheGeneration(): number {
  return cacheGeneration;
}

/**
 * Narrow typed cancellation for a request crossed by logout or key
 * invalidation. Thrown (never returned as data) when the generation captured
 * at request start no longer matches at settle time. Store consumers MUST
 * swallow it silently (no Pinia write, no user-facing error): it is a cache
 * lifecycle event, not a backend failure.
 */
export class CacheStaleError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`[cache] generation stale for key "${key}" (logout crossed fetch)`);
    this.name = 'CacheStaleError';
    this.key = key;
  }
}

/** Narrow check for the logout-crossed-fetch cancellation (see CacheStaleError). */
export function isCacheStaleError(e: unknown): e is CacheStaleError {
  return (
    e instanceof CacheStaleError ||
    (e as { name?: unknown } | null)?.name === 'CacheStaleError'
  );
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, { gen: number; keyGen: number; promise: Promise<unknown> }>();

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
  const keyGenAtStart = keyGeneration.get(key) ?? 0;
  const entry = store.get(key);
  // Only serve entries written in the CURRENT generation. (clearCache() clears
  // the map, so a cross-generation entry should not exist; the gen check is
  // defense-in-depth against a write that slipped the post-fetch guard.)
  if (entry && entry.gen === genAtStart) {
    const age = Date.now() - entry.fetchedAt;
    if (age < opts.freshTtl) {
      return guardGeneration(Promise.resolve(entry.value as T), key, genAtStart, keyGenAtStart);
    }
    if (age < opts.staleTtl) {
      // stale: serve cache now, refresh in background (fire-and-forget)
      void refresh(key, fetcher, genAtStart, keyGenAtStart);
      return guardGeneration(Promise.resolve(entry.value as T), key, genAtStart, keyGenAtStart);
    }
  }
  // expired, miss, or stale-generation entry: sync fetch
  // A wipe that crossed this fetch orphans the result: fetchOne REJECTS with
  // CacheStaleError, so the original waiter is cancelled (never receives
  // pre-wipe data) and the store write below is unreachable for stale gens.
  const fresh = await fetchOne(key, fetcher, genAtStart, keyGenAtStart);
  // A nullish upstream result is not a usable cache entry. Keeping the prior
  // value (when any) is safer than turning a transient/partial response into a
  // fresh cache hit that hides valid data from another route.
  if (fresh != null && genAtStart === cacheGeneration && keyGenAtStart === (keyGeneration.get(key) ?? 0)) {
    store.set(key, { value: fresh, fetchedAt: Date.now(), gen: genAtStart });
  }
  return fresh;
}

async function fetchOne<T>(key: string, fetcher: () => Promise<T>, gen: number, keyGen: number): Promise<T> {
  const existing = inflight.get(key);
  // Join ONLY same-generation/key-generation flights. A B-era request arriving while an
  // orphaned A-era flight is pending starts its OWN fetch (overwrites the map
  // slot); the orphaned flight's guarded finally below cannot clear it.
  if (existing && existing.gen === gen && existing.keyGen === keyGen) {
    // Do not return the raw shared promise: every waiter owns a separate
    // generation check at its settle boundary. Otherwise a joined waiter
    // bypasses the owner's guarded await and can receive stale A data.
    return guardGeneration(existing.promise as Promise<T>, key, gen, keyGen);
  }
  let p: Promise<T>;
  try {
    p = Promise.resolve(fetcher());
  } catch (e) {
    return Promise.reject(e); // synchronous throw → reject without polluting inflight
  }
  const record = { gen, keyGen, promise: p as Promise<unknown> };
  inflight.set(key, record);
  try {
    const value = await p;
    // Session or key generation crossed while fetching: cancel the orphaned
    // waiter with a typed rejection — never satisfy it with old data or
    // populate the store.
    if (gen !== cacheGeneration || keyGen !== (keyGeneration.get(key) ?? 0)) throw new CacheStaleError(key);
    return value;
  } catch (e) {
    // A rejected upstream fetch is stale too when either generation crossed.
    // Preserve ordinary failures only while the request still belongs to both.
    if (gen !== cacheGeneration || keyGen !== (keyGeneration.get(key) ?? 0)) throw new CacheStaleError(key);
    throw e;
  } finally {
    // Identity-guarded cleanup: an orphaned A-era finally must never clear a
    // newer B-era flight stored under the same key.
    if (inflight.get(key) === record) inflight.delete(key);
  }
}

function guardGeneration<T>(promise: Promise<T>, key: string, gen: number, keyGen: number): Promise<T> {
  return promise.then(
    (value) => {
      if (gen !== cacheGeneration || keyGen !== (keyGeneration.get(key) ?? 0)) throw new CacheStaleError(key);
      return value;
    },
    (error) => {
      if (gen !== cacheGeneration || keyGen !== (keyGeneration.get(key) ?? 0)) throw new CacheStaleError(key);
      throw error;
    },
  );
}

async function refresh<T>(key: string, fetcher: () => Promise<T>, gen: number, keyGen: number): Promise<void> {
  try {
    const value = await fetchOne(key, fetcher, gen, keyGen);
    // A wipe that crossed the background flight orphans the value.
    if (gen !== cacheGeneration || keyGen !== (keyGeneration.get(key) ?? 0)) return;
    if (value != null) {
      store.set(key, { value, fetchedAt: Date.now(), gen });
    }
  } catch (e) {
    if (isCacheStaleError(e)) return; // crossed wipe — stay wiped, stay silent
    // Background refresh failure: keep stale data, never surface an alert.
    console.debug('[cache] background refresh failed', key, e);
  }
}

export function invalidate(key: string): void {
  keyGeneration.set(key, (keyGeneration.get(key) ?? 0) + 1);
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
