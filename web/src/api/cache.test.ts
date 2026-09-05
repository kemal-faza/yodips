import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getCached, invalidate, clearCache, CacheStaleError, isCacheStaleError } from './cache';

const FRESH = 60_000;   // 1 min
const STALE = 300_000;  // 5 min

async function settle(ms = 10) { await new Promise((r) => setTimeout(r, ms)); }

describe('cache layer', () => {
  beforeEach(() => { clearCache(); vi.useRealTimers(); });

  it('serves fresh data from cache with no network', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    const a = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(a).toBe('v1');
    const b = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(b).toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a fresh cache-hit delivery when clearCache crosses before await', async () => {
    const fetcher = vi.fn().mockResolvedValue('old');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });

    const pending = getCached('k', vi.fn().mockResolvedValue('unexpected'), {
      freshTtl: FRESH,
      staleTtl: STALE,
    });
    clearCache(); // synchronous wipe between getCached() and the caller's await

    await expect(pending).rejects.toBeInstanceOf(CacheStaleError);
  });

  it('serves stale data and refreshes in the background exactly once', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    // advance past freshTtl so the entry is stale
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FRESH + 1);
    const result = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(result).toBe('old'); // stale served synchronously
    vi.useRealTimers();
    await settle();
    const next = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(next).toBe('new'); // cache now refreshed
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale cache-hit delivery when clearCache crosses before await', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FRESH + 1);

    const pending = getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    clearCache(); // crosses both the stale delivery and its background refresh

    await expect(pending).rejects.toBeInstanceOf(CacheStaleError);
    vi.useRealTimers();
  });

  it('refetches synchronously when expired (age >= staleTtl)', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + STALE + 1);
    const result = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useRealTimers();
    expect(result).toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(2); // sync refetch, not background
  });

  it('single-flights concurrent callers of the same key', async () => {
    let resolveFetch!: (v: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((res) => { resolveFetch = res; }));
    const p1 = getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    const p2 = getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    resolveFetch('shared');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['shared', 'shared']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('invalidate forces a refetch on the next call', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    invalidate('k');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clearCache empties all entries', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    clearCache();
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps stale data when background refresh fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('boom'));
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FRESH + 1);
    const result = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useRealTimers();
    expect(result).toBe('old'); // background failure keeps stale
    await settle();
    const next = await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(next).toBe('old'); // still stale, no throw
  });
});

describe('cache epoch ownership (A-era logout vs B-era request)', () => {
  beforeEach(() => { clearCache(); vi.useRealTimers(); });

  it('old success resolving after clearCache never populates the store', async () => {
    // A-era fetch starts and is still in flight when logout clears the cache.
    // The production seam is getCached itself (deferred fetcher = deterministic).
    // CRITICAL: the orphaned waiter is CANCELLED with CacheStaleError — it
    // must never be satisfied with pre-wipe A data.
    let resolveA!: (v: string) => void;
    const fetcherA = vi.fn(() => new Promise<string>((res) => { resolveA = res; }));
    const pA = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    void pA.catch(() => {}); // typed stale rejection asserted below, never unhandled
    clearCache(); // models logout's wipe crossing the in-flight fetch
    resolveA('A-data');
    await expect(pA).rejects.toBeInstanceOf(CacheStaleError);
    // B-era fetch after the wipe must MISS — A-data must never have been written.
    const fetcherB = vi.fn().mockResolvedValue('B-data');
    const b = await getCached('k', fetcherB, { freshTtl: FRESH, staleTtl: STALE });
    expect(b).toBe('B-data');
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('B-era request never joins an A-era flight and never receives A data', async () => {
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const fetcherA = vi.fn(() => new Promise<string>((res) => { resolveA = res; }));
    const fetcherB = vi.fn(() => new Promise<string>((res) => { resolveB = res; }));
    const pA = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    void pA.catch(() => {}); // orphaned A waiter rejects typed, never unhandled
    clearCache(); // logout crosses: generation advances while A is pending
    const pB = getCached('k', fetcherB, { freshTtl: FRESH, staleTtl: STALE });
    // B must start its OWN fetch — never piggyback on the orphaned A flight.
    expect(fetcherB).toHaveBeenCalledTimes(1);
    resolveA('A-data');
    resolveB('B-data');
    await expect(pA).rejects.toBeInstanceOf(CacheStaleError);
    await expect(pB).resolves.toBe('B-data'); // B receives B, never A
    // Cache now holds B-data, not A-data: a fresh read serves B with no network.
    const fetcherC = vi.fn().mockResolvedValue('C-unexpected');
    const c = await getCached('k', fetcherC, { freshTtl: FRESH, staleTtl: STALE });
    expect(c).toBe('B-data');
    expect(fetcherC).not.toHaveBeenCalled();
  });

  it('rejects every original waiter when a shared A-era flight crosses clearCache', async () => {
    let resolveA!: (v: string) => void;
    const fetcherA = vi.fn(() => new Promise<string>((resolve) => { resolveA = resolve; }));
    const pA1 = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    const pA2 = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    void pA1.catch(() => {});
    void pA2.catch(() => {});

    clearCache();
    resolveA('A-data');

    await expect(pA1).rejects.toBeInstanceOf(CacheStaleError);
    await expect(pA2).rejects.toBeInstanceOf(CacheStaleError);
  });

  it('stale background refresh that crosses clearCache never writes', async () => {
    const fetcher = vi.fn().mockResolvedValue('old');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FRESH + 1);
    let resolveBg!: (v: string) => void;
    const bgFetcher = vi.fn(() => new Promise<string>((res) => { resolveBg = res; }));
    // Stale hit serves 'old' and kicks a background refresh (deferred).
    const stale = await getCached('k', bgFetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(stale).toBe('old');
    clearCache(); // logout crosses the background flight
    resolveBg('bg-new');
    vi.useRealTimers();
    await settle();
    // Store was wiped and the late background value must not resurrect it.
    const fetcherB = vi.fn().mockResolvedValue('B-data');
    const b = await getCached('k', fetcherB, { freshTtl: FRESH, staleTtl: STALE });
    expect(b).toBe('B-data');
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });
});

describe('cache generation-stale rejection (CRITICAL: logout-crossed waiter)', () => {
  beforeEach(() => { clearCache(); vi.useRealTimers(); });

  it('isCacheStaleError narrows only the stale-generation failure', () => {
    expect(isCacheStaleError(new CacheStaleError('k'))).toBe(true);
    expect(isCacheStaleError(new Error('boom'))).toBe(false);
    expect(isCacheStaleError(null)).toBe(false);
    expect(isCacheStaleError({ name: 'CacheStaleError' })).toBe(true);
  });

  it('original A waiter REJECTS with CacheStaleError instead of receiving A data', async () => {
    // A-era fetch starts and is still in flight when logout clears the cache.
    // The orphaned A result must never satisfy the original waiter with
    // pre-wipe (logged-out user) data — the waiter is cancelled via a narrow
    // typed rejection that store consumers swallow silently.
    let resolveA!: (v: string) => void;
    const fetcherA = vi.fn(() => new Promise<string>((res) => { resolveA = res; }));
    const pA = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    void pA.catch(() => {}); // observe early: the rejection below is asserted, never unhandled
    clearCache(); // models logout's wipe crossing the in-flight fetch
    resolveA('A-data');
    await expect(pA).rejects.toBeInstanceOf(CacheStaleError);
    await expect(pA).rejects.toMatchObject({ name: 'CacheStaleError' });
  });

  it('B-era request after the wipe fetches fresh and never observes A data', async () => {
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const fetcherA = vi.fn(() => new Promise<string>((res) => { resolveA = res; }));
    const fetcherB = vi.fn(() => new Promise<string>((res) => { resolveB = res; }));
    const pA = getCached('k', fetcherA, { freshTtl: FRESH, staleTtl: STALE });
    void pA.catch(() => {}); // stale rejection asserted below, never unhandled
    clearCache(); // logout crosses: generation advances while A is pending
    const pB = getCached('k', fetcherB, { freshTtl: FRESH, staleTtl: STALE });
    // B must start its OWN fetch — never piggyback on the orphaned A flight.
    expect(fetcherB).toHaveBeenCalledTimes(1);
    resolveA('A-data');
    resolveB('B-data');
    await expect(pA).rejects.toBeInstanceOf(CacheStaleError);
    await expect(pB).resolves.toBe('B-data'); // B receives B, never A
    // Cache now holds B-data, not A-data: a fresh read serves B with no network.
    const fetcherC = vi.fn().mockResolvedValue('C-unexpected');
    const c = await getCached('k', fetcherC, { freshTtl: FRESH, staleTtl: STALE });
    expect(c).toBe('B-data');
    expect(fetcherC).not.toHaveBeenCalled();
  });

  it('stale background refresh rejects internally and stays silent (no write, no throw)', async () => {
    const fetcher = vi.fn().mockResolvedValue('old');
    await getCached('k', fetcher, { freshTtl: FRESH, staleTtl: STALE });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FRESH + 1);
    let resolveBg!: (v: string) => void;
    const bgFetcher = vi.fn(() => new Promise<string>((res) => { resolveBg = res; }));
    const stale = await getCached('k', bgFetcher, { freshTtl: FRESH, staleTtl: STALE });
    expect(stale).toBe('old');
    clearCache(); // logout crosses the background flight
    resolveBg('bg-new');
    vi.useRealTimers();
    await settle();
    const fetcherB = vi.fn().mockResolvedValue('B-data');
    const b = await getCached('k', fetcherB, { freshTtl: FRESH, staleTtl: STALE });
    expect(b).toBe('B-data');
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });
});
