// backend/src/common/single-flight.spec.ts
import { SingleFlight, createKeyedSingleFlight } from './single-flight';

describe('SingleFlight', () => {
  it('coalesces concurrent callers into one execution', async () => {
    let runs = 0;
    const sf = new SingleFlight<string>();
    const fn = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 10));
      return 'value';
    };
    const [a, b, c] = await Promise.all([sf.run(fn), sf.run(fn), sf.run(fn)]);
    expect(runs).toBe(1);
    expect([a, b, c]).toEqual(['value', 'value', 'value']);
  });

  it('propagates the same error to all concurrent callers', async () => {
    let runs = 0;
    const sf = new SingleFlight<string>();
    const fn = async () => {
      runs++;
      throw new Error('boom');
    };
    await expect(Promise.all([sf.run(fn), sf.run(fn)])).rejects.toThrow('boom');
    expect(runs).toBe(1);
  });

  it('allows a fresh run after completion (finally cleanup)', async () => {
    const sf = new SingleFlight<string>();
    let runs = 0;
    const fn = async () => {
      runs++;
      return 'v';
    };
    await sf.run(fn);
    await sf.run(fn);
    expect(runs).toBe(2);
  });
});

describe('createKeyedSingleFlight', () => {
  it('dedupes per key, runs independent keys in parallel', async () => {
    const ksf = createKeyedSingleFlight<string>();
    let aRuns = 0;
    let bRuns = 0;
    const [ra, , rb] = await Promise.all([
      ksf.run('a', async () => { aRuns++; return 'a'; }),
      ksf.run('a', async () => { aRuns++; return 'a'; }),
      ksf.run('b', async () => { bRuns++; return 'b'; }),
    ]);
    expect(aRuns).toBe(1);
    expect(bRuns).toBe(1);
    expect(ra).toBe('a');
    expect(rb).toBe('b');
  });

  it('removes the entry after completion (fresh run allowed)', async () => {
    const ksf = createKeyedSingleFlight<string>();
    let runs = 0;
    const fn = async () => { runs++; return 'v'; };
    await ksf.run('k', fn);
    await ksf.run('k', fn);
    expect(runs).toBe(2);
  });
});
