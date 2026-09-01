import 'reflect-metadata';
import { InMemoryDataCache } from './in-memory-data.cache';
import { handleBackgroundError } from './data-cache';
import type { TelemetryRuntime } from '../observability/telemetry';
import type { TelemetryEventInput } from '../observability/telemetry-contract';

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

describe('InMemoryDataCache', () => {
  it('stores and returns a JSON round-tripped value', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set('u:kulon:courses', [{ id: 1, name: 'A' }], 60_000);
    expect(await c.get<{ id: number; name: string }[]>('u:kulon:courses')).toEqual([{ id: 1, name: 'A' }]);
  });
  it('returns null when the key is absent or expired by TTL', async () => {
    const c = new InMemoryDataCache(60_000);
    expect(await c.get('missing')).toBeNull();
    await c.set('k', 'v', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await c.get('k')).toBeNull();
  });
  it('deletes a key', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set('k', 'v');
    await c.del('k');
    expect(await c.get('k')).toBeNull();
  });
  it('stores null as a miss', async () => {
    const c = new InMemoryDataCache(60_000);
    await c.set<null>('n', null);
    expect(await c.get('n')).toBeNull();
  });

  it('keeps SWR data past ordinary expiry and emits a classified stale read', async () => {
    const wall = { value: 1_000_000 };
    const runtime = recordingRuntime(wall);
    const c = new InMemoryDataCache(60_000, runtime);
    await c.set('123:siap:profile', 'old');
    wall.value += 60_001;

    await expect(c.getStale('123:siap:profile', jest.fn().mockResolvedValue('new'), {
      freshTtlMs: 30_000,
      staleTtlMs: 120_000,
    })).resolves.toEqual({ value: 'old', stale: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(runtime.events.map(({ event, outcome }) => `${event}:${outcome}`)).toEqual([
      'cache.read:stale',
      'cache.refresh:started',
      'cache.refresh:ok',
    ]);
  });

  it('rethrows the original storage failure while policy recognizes its marker', async () => {
    const c = new InMemoryDataCache(60_000);
    const original = new Error('map failure');
    const entries = (c as unknown as { entries: Map<string, unknown> }).entries;
    jest.spyOn(entries, 'get').mockImplementation(() => {
      throw original;
    });

    await expect(Promise.resolve().then(() => c.get('k'))).rejects.toBe(original);
    await expect(handleBackgroundError({ del: jest.fn() }, 'k', original)).resolves.toEqual({
      outcome: 'error',
      reason: 'unexpected',
      keepStale: true,
    });
  });
});
