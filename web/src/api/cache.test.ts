import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getCached, invalidate, clearCache } from './cache';

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
