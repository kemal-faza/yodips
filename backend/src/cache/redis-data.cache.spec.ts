import 'reflect-metadata';
import Redis from 'ioredis';
import { RedisDataCache } from './redis-data.cache';
import { handleBackgroundError } from './data-cache';
import type { TelemetryRuntime } from '../observability/telemetry';
import type { TelemetryEventInput } from '../observability/telemetry-contract';

jest.mock('ioredis');

const mockClient = { set: jest.fn(), get: jest.fn(), del: jest.fn(), quit: jest.fn() };

let cache: RedisDataCache;
beforeEach(() => {
  jest.clearAllMocks();
  (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
  cache = new RedisDataCache(mockClient as unknown as Redis, 60_000);
});

function recordingRuntime(wall: { value: number }): TelemetryRuntime & { events: TelemetryEventInput[] } {
  const events: TelemetryEventInput[] = [];
  let monotonic = 0n;
  return {
    events,
    sink: { record: (event) => events.push(event) },
    wallNowMs: () => wall.value,
    monotonicNowNs: () => {
      monotonic += 1_000_000n;
      return monotonic;
    },
  };
}

describe('RedisDataCache', () => {
  it('set() writes envelope JSON with EX ttl (ms→sec)', async () => {
    mockClient.set.mockResolvedValue('OK');
    await cache.set('u:siap:profile', { nama: 'Budi' }, 60_000);
    const [key, raw, exFlag, ttlSec] = mockClient.set.mock.calls[0];
    expect(key).toBe('sso:cache:u:siap:profile');
    expect(exFlag).toBe('EX');
    expect(ttlSec).toBe(60);
    const parsed = JSON.parse(raw as string) as { v: { nama: string }; fa: number; ex: number };
    expect(parsed.v).toEqual({ nama: 'Budi' });
    expect(typeof parsed.fa).toBe('number');
    expect(typeof parsed.ex).toBe('number');
  });
  it('get() unwraps the envelope and returns the bare value', async () => {
    const env = JSON.stringify({ v: [{ id: 1 }], fa: Date.now(), ex: Date.now() + 60_000 });
    mockClient.get.mockResolvedValue(env);
    expect(await cache.get('u:kulon:assignments')).toEqual([{ id: 1 }]);
  });
  it('get() parses legacy bare JSON (no fa) as null (treated as miss)', async () => {
    mockClient.get.mockResolvedValue('[{"id":1}]');
    expect(await cache.get('u:kulon:assignments')).toBeNull();
    expect(mockClient.del).toHaveBeenCalledWith('sso:cache:u:kulon:assignments');
  });
  it('get() returns null on a Redis miss', async () => {
    mockClient.get.mockResolvedValue(null);
    expect(await cache.get('u:kulon:courses')).toBeNull();
  });
  it('del() issues DEL', async () => {
    await cache.del('u:siap:khs');
    expect(mockClient.del).toHaveBeenCalledWith('sso:cache:u:siap:khs');
  });

  it('removes malformed, legacy, and impossible envelopes before sync refresh', async () => {
    mockClient.get.mockResolvedValueOnce('{broken');
    mockClient.del.mockResolvedValue(1);
    mockClient.set.mockResolvedValue('OK');
    const fetcher = jest.fn().mockResolvedValue('fresh');

    await expect(cache.getStale('123:kulon:courses', fetcher, {
      freshTtlMs: 10_000,
      staleTtlMs: 20_000,
    })).resolves.toEqual({ value: 'fresh', stale: false });

    expect(mockClient.del).toHaveBeenCalledWith('sso:cache:123:kulon:courses');
    expect(mockClient.set).toHaveBeenCalledWith(
      'sso:cache:123:kulon:courses',
      expect.any(String),
      'EX',
      30,
    );
  });

  it('emits expired for a valid envelope beyond the SWR cutoff', async () => {
    const wall = { value: 1_000_000 };
    const runtime = recordingRuntime(wall);
    cache = new RedisDataCache(mockClient as unknown as Redis, 60_000, runtime);
    mockClient.get.mockResolvedValue(JSON.stringify({
      v: 'old',
      fa: wall.value - 50_001,
      ex: wall.value - 1,
    }));
    mockClient.set.mockResolvedValue('OK');

    await expect(cache.getStale('123:siap:profile', jest.fn().mockResolvedValue('new'), {
      freshTtlMs: 30_000,
      staleTtlMs: 20_000,
    })).resolves.toEqual({ value: 'new', stale: false });

    expect(runtime.events[0]).toMatchObject({
      event: 'cache.read',
      cache: 'siap.profile',
      backend: 'redis',
      outcome: 'expired',
      ageMs: 50_001,
      freshTtlMs: 30_000,
      staleTtlMs: 20_000,
    });
  });

  it('rethrows the original Redis storage failure while policy recognizes its marker', async () => {
    const original = new Error('redis failure');
    mockClient.get.mockRejectedValue(original);
    await expect(cache.get('k')).rejects.toBe(original);
    await expect(handleBackgroundError({ del: jest.fn() }, 'k', original)).resolves.toEqual({
      outcome: 'error',
      reason: 'unexpected',
      keepStale: true,
    });
  });
});
