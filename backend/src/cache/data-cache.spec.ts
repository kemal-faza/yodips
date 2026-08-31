import 'reflect-metadata';
import { InMemoryDataCache } from './in-memory-data.cache';
import { RedisDataCache } from './redis-data.cache';
import { defaultStaleTtlMs, handleBackgroundError } from './data-cache';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import Redis from 'ioredis';

jest.mock('ioredis');
const mockClient = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
};
(Redis as unknown as jest.Mock).mockImplementation(() => mockClient);

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.get.mockResolvedValue(null);
});

async function withInMemory(
  fn: (c: InMemoryDataCache) => Promise<void>,
): Promise<void> {
  const c = new InMemoryDataCache(60_000);
  await fn(c);
}
async function withRedis(
  fn: (c: RedisDataCache) => Promise<void>,
): Promise<void> {
  const c = new RedisDataCache(mockClient as unknown as Redis, 60_000);
  await fn(c);
}

/** Age the in-memory entry's fetchedAt into the stale window (entry stays unexpired). */
function ageInMemory(c: InMemoryDataCache, key: string, ageMs: number): void {
  const entries = (
    c as unknown as { entries: Map<string, { fetchedAt: number }> }
  ).entries;
  const e = entries.get(key);
  if (e) e.fetchedAt = Date.now() - ageMs;
}

describe('getStale (shared behavior)', () => {
  it('miss → sync fetch, stale=false', async () => {
    await withInMemory(async (c) => {
      const fetcher = jest.fn().mockResolvedValue('fresh');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 10_000,
        staleTtlMs: 20_000,
      });
      expect(r).toEqual({ value: 'fresh', stale: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    await withRedis(async (c) => {
      mockClient.get.mockResolvedValue(null);
      const fetcher = jest.fn().mockResolvedValue('fresh');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 10_000,
        staleTtlMs: 20_000,
      });
      expect(r).toEqual({ value: 'fresh', stale: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('fresh → cached, no refresh', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'v1');
      const fetcher = jest.fn().mockResolvedValue('v2');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 60_000,
        staleTtlMs: 120_000,
      });
      expect(r).toEqual({ value: 'v1', stale: false });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  it('stale → serves stale immediately + exactly one background refresh', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'old');
      // Manipulate internal entry age: backdate fetchedAt so the entry is stale
      // but still unexpired (a 1ms TTL + wait would expire it entirely).
      ageInMemory(c, 'k', 60_000);
      const fetcher = jest.fn().mockResolvedValue('new');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      expect(r.value).toBe('old');
      expect(r.stale).toBe(true);
      // Background refresh resolves; allow microtasks to settle
      await new Promise((r) => setTimeout(r, 5));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await c.get('k')).toBe('new');
    });
  });

  it('expired → sync fetch (no stale serve)', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'old', 1);
      await new Promise((r) => setTimeout(r, 5));
      const fetcher = jest.fn().mockResolvedValue('new');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 0,
        staleTtlMs: 0,
      });
      expect(r).toEqual({ value: 'new', stale: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('treats staleTtlMs as a duration after fresh TTL, including the cutoff boundary', async () => {
    await withInMemory(async (c) => {
      await c.set('inside', 'old', 600_000);
      ageInMemory(c, 'inside', 125_000);
      const inside = await c.getStale(
        'inside',
        jest.fn().mockResolvedValue('new'),
        {
          freshTtlMs: 100_000,
          staleTtlMs: 50_000,
        },
      );
      expect(inside).toEqual({ value: 'old', stale: true });

      await c.set('at-cutoff', 'old', 600_000);
      ageInMemory(c, 'at-cutoff', 150_000);
      const fetcher = jest.fn().mockResolvedValue('new');
      const atCutoff = await c.getStale('at-cutoff', fetcher, {
        freshTtlMs: 100_000,
        staleTtlMs: 50_000,
      });
      expect(atCutoff).toEqual({ value: 'new', stale: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('retains a freshly fetched entry through its stale cutoff', async () => {
    await withInMemory(async (c) => {
      await c.getStale('k', jest.fn().mockResolvedValue('fresh'), {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      const e = (
        c as unknown as {
          entries: Map<string, { fetchedAt: number; expiresAt: number }>;
        }
      ).entries.get('k')!;
      expect(e.expiresAt - e.fetchedAt).toBe(150_000);
    });

    await withRedis(async (c) => {
      const fetcher = jest.fn().mockResolvedValue('fresh');
      await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      expect(mockClient.set).toHaveBeenCalledWith(
        'sso:cache:k',
        expect.any(String),
        'EX',
        150,
      );
    });
  });

  it('successful refresh survives into a second stale window without a sync fetch', async () => {
    const dateNow = jest.spyOn(Date, 'now');
    let now = 1_000_000;
    dateNow.mockImplementation(() => now);
    try {
      await withInMemory(async (c) => {
        await c.set('k', 'old', 600_000);
        now += 125_000;

        const refresh = jest.fn().mockResolvedValue('new');
        await c.getStale('k', refresh, {
          freshTtlMs: 100_000,
          staleTtlMs: 50_000,
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(refresh).toHaveBeenCalledTimes(1);

        // The refreshed value is 125s old at this point: stale, but still
        // physically retained until the 150s fresh+stale cutoff.
        now += 125_000;
        const secondRefresh = jest.fn().mockResolvedValue('second-refresh');
        const second = await c.getStale('k', secondRefresh, {
          freshTtlMs: 100_000,
          staleTtlMs: 50_000,
        });
        expect(second).toEqual({ value: 'new', stale: true });
        // A stale result proves this call did not synchronously fetch. The
        // fetcher may still be invoked by the expected background refresh.
        expect(secondRefresh).toHaveBeenCalledTimes(1);
      });

      await withRedis(async (c) => {
        now = 1_000_000 + 125_000;
        let raw = JSON.stringify({
          v: 'old',
          fa: 1_000_000,
          ex: now + 475_000,
        });
        mockClient.get.mockImplementation(async () => {
          if (Date.now() > (JSON.parse(raw) as { ex: number }).ex) return null;
          return raw;
        });
        mockClient.set.mockImplementation(
          async (_key: string, value: string) => {
            raw = value;
          },
        );
        const refresh = jest.fn().mockResolvedValue('new');
        const first = await c.getStale('k', refresh, {
          freshTtlMs: 100_000,
          staleTtlMs: 50_000,
        });
        expect(first).toEqual({ value: 'old', stale: true });
        await new Promise((r) => setTimeout(r, 5));
        expect(refresh).toHaveBeenCalledTimes(1);

        now += 125_000;
        const secondRefresh = jest.fn().mockResolvedValue('second-refresh');
        const second = await c.getStale('k', secondRefresh, {
          freshTtlMs: 100_000,
          staleTtlMs: 50_000,
        });
        expect(second).toEqual({ value: 'new', stale: true });
        expect(secondRefresh).toHaveBeenCalledTimes(1);
        mockClient.set.mockReset();
      });
    } finally {
      dateNow.mockRestore();
    }
  });

  it('retains long-TTL payloads through the capped stale window', async () => {
    const opts = {
      freshTtlMs: 86_400_000,
      staleTtlMs: defaultStaleTtlMs(86_400_000),
    };
    await withInMemory(async (c) => {
      await c.getStale('k', jest.fn().mockResolvedValue('fresh'), opts);
      const e = (
        c as unknown as {
          entries: Map<string, { fetchedAt: number; expiresAt: number }>;
        }
      ).entries.get('k')!;
      expect(e.expiresAt - e.fetchedAt).toBe(88_200_000);
    });
    await withRedis(async (c) => {
      await c.getStale('k', jest.fn().mockResolvedValue('fresh'), opts);
      expect(mockClient.set).toHaveBeenCalledWith(
        'sso:cache:k',
        expect.any(String),
        'EX',
        88_200,
      );
    });
  });

  it('concurrent stale reads → single background fetch (piggyback)', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'old');
      ageInMemory(c, 'k', 60_000);
      const fetcher = jest.fn().mockResolvedValue('new');
      const [r1, r2, r3] = await Promise.all([
        c.getStale('k', fetcher, { freshTtlMs: 30_000, staleTtlMs: 120_000 }),
        c.getStale('k', fetcher, { freshTtlMs: 30_000, staleTtlMs: 120_000 }),
        c.getStale('k', fetcher, { freshTtlMs: 30_000, staleTtlMs: 120_000 }),
      ]);
      expect(r1.stale).toBe(true);
      expect(r2.stale).toBe(true);
      expect(r3.stale).toBe(true);
      await new Promise((r) => setTimeout(r, 5));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await c.get('k')).toBe('new');
    });
  });

  it('background 401 (dead session) → key deleted; next get is miss', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'old');
      ageInMemory(c, 'k', 60_000);
      const fetcher = jest
        .fn()
        .mockRejectedValue(new StaleUpstreamError('Kulon', 'login-redirect'));
      await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(await c.get('k')).toBeNull();
    });
  });

  it('background transient failure → stale kept', async () => {
    await withInMemory(async (c) => {
      await c.set('k', 'old');
      ageInMemory(c, 'k', 60_000);
      const fetcher = jest
        .fn()
        .mockRejectedValue(new StaleUpstreamError('Kulon', 'fetch-threw'));
      await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(await c.get('k')).toBe('old');
    });
  });

  it('Redis stale entry serves immediately and refreshes in the background', async () => {
    mockClient.get.mockResolvedValue(
      JSON.stringify({
        v: 'old',
        fa: Date.now() - 60_000,
        ex: Date.now() + 120_000,
      }),
    );
    await withRedis(async (c) => {
      const fetcher = jest.fn().mockResolvedValue('new');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      expect(r).toEqual({ value: 'old', stale: true });
      await new Promise((r) => setTimeout(r, 5));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockClient.set).toHaveBeenCalled();
    });
  });

  it('legacy bare JSON entry (no fa) → treated as miss (sync fetch)', async () => {
    mockClient.get.mockResolvedValue('[{"id":1}]');
    await withRedis(async (c) => {
      const fetcher = jest.fn().mockResolvedValue('fresh');
      const r = await c.getStale('k', fetcher, {
        freshTtlMs: 10_000,
        staleTtlMs: 20_000,
      });
      expect(r).toEqual({ value: 'fresh', stale: false });
      expect(mockClient.set).toHaveBeenCalledWith(
        'sso:cache:k',
        expect.any(String),
        'EX',
        30,
      );
    });
  });
});

describe('SWR observability', () => {
  it('logs swr refresh ok after a successful background refresh', async () => {
    await withInMemory(async (c) => {
      const logger = c['logger'] as unknown as { debug: jest.Mock };
      const spy = jest
        .spyOn(logger, 'debug')
        .mockImplementation(() => undefined);
      await c.set('k', 'old');
      ageInMemory(c, 'k', 60_000);
      const fetcher = jest.fn().mockResolvedValue('new');
      await c.getStale('k', fetcher, {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(
        spy.mock.calls.some((call) =>
          String(call[0]).includes('swr refresh ok'),
        ),
      ).toBe(true);
      spy.mockRestore();
    });
  });

  it('does not log swr refresh ok before the in-memory write succeeds', async () => {
    await withInMemory(async (c) => {
      const logger = c['logger'] as unknown as { debug: jest.Mock };
      const spy = jest
        .spyOn(logger, 'debug')
        .mockImplementation(() => undefined);
      await c.set('k', 'old');
      ageInMemory(c, 'k', 60_000);

      let resolveWrite!: () => void;
      const pendingWrite = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      const setSpy = jest.spyOn(c, 'set').mockReturnValue(pendingWrite);

      await c.getStale('k', jest.fn().mockResolvedValue('new'), {
        freshTtlMs: 30_000,
        staleTtlMs: 120_000,
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(
        spy.mock.calls.some((call) =>
          String(call[0]).includes('swr refresh ok'),
        ),
      ).toBe(false);

      resolveWrite();
      await new Promise((r) => setTimeout(r, 5));
      expect(
        spy.mock.calls.some((call) =>
          String(call[0]).includes('swr refresh ok'),
        ),
      ).toBe(true);
      setSpy.mockRestore();
      spy.mockRestore();
    });
  });
});

describe('defaultStaleTtlMs', () => {
  it('short TTL → x2', () => {
    expect(defaultStaleTtlMs(300_000)).toBe(600_000);
  });
  it('long TTL (>= 15 min) → capped at 30 min', () => {
    expect(defaultStaleTtlMs(1_800_000)).toBe(1_800_000); // 30min fresh → 30min stale cap
    expect(defaultStaleTtlMs(86_400_000)).toBe(1_800_000); // 24h fresh → capped 30min stale
  });
});

describe('handleBackgroundError', () => {
  it('dead-session reasons → hard-expire', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    for (const reason of [
      'login-redirect',
      'no-cookie',
      'api-credential',
      'redirect-loop',
      'html-content-type',
      'malformed-json',
      'no-emailSso',
      'non-json-process',
    ]) {
      const e = new StaleUpstreamError('Siap', reason);
      await handleBackgroundError({ del }, 'k', e);
    }
    expect(del).toHaveBeenCalledTimes(8);
  });
  it('transient reasons → keep (no del)', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    for (const reason of ['fetch-threw', 'api-endpoint']) {
      await handleBackgroundError(
        { del },
        'k',
        new StaleUpstreamError('Kulon', reason),
      );
    }
    // http-not-ok with upstream 500+ → statusForStaleReason maps to 502 → transient
    await handleBackgroundError(
      { del },
      'k',
      new StaleUpstreamError('Kulon', 'http-not-ok', undefined, {
        status: 502,
      } as Response),
    );
    expect(del).not.toHaveBeenCalled();
  });
  it('http-not-ok with upstream 4xx → statusForStaleReason maps to 401 → dead-session (hard-expire)', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    await handleBackgroundError(
      { del },
      'k',
      new StaleUpstreamError('Kulon', 'http-not-ok', undefined, {
        status: 401,
      } as Response),
    );
    expect(del).toHaveBeenCalledTimes(1);
  });
  it('no-api-upstream → transient (no del)', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    await handleBackgroundError(
      { del },
      'k',
      new StaleUpstreamError('Siap', 'no-api-upstream'),
    );
    expect(del).not.toHaveBeenCalled();
  });
});
