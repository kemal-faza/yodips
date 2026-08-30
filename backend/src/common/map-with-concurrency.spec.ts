// backend/src/common/map-with-concurrency.spec.ts
import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('runs all items and preserves input order', async () => {
    const result = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (n) => n * 10,
    );
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds `limit` concurrent executions', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      4,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return peak;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('propagates the first rejection (like Promise.all)', async () => {
    const calls: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        calls.push(n);
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('resolves [] for empty items without calling fn', async () => {
    const fn = jest.fn();
    const result = await mapWithConcurrency([], 4, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws for limit <= 0', async () => {
    await expect(
      mapWithConcurrency([1], 0, async (n) => n),
    ).rejects.toThrow();
  });
});
