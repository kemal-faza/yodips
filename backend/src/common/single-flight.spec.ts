// backend/src/common/single-flight.spec.ts
import { SingleFlight, createKeyedSingleFlight } from './single-flight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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
  it('reports one owner and shares the installed promise', async () => {
    const flight = createKeyedSingleFlight<number>();
    const first = deferred<number>();
    let starts = 0;

    const owner = flight.runOwned('k', () => first.promise, () => starts++);
    const follower = flight.runOwned('k', async () => 99, () => starts++);

    expect(owner.owner).toBe(true);
    expect(follower.owner).toBe(false);
    expect(follower.promise).toBe(owner.promise);
    expect(starts).toBe(1);

    first.resolve(42);
    await expect(owner.promise).resolves.toBe(42);
  });

  it('installs the owner promise before the callback and task run', async () => {
    const flight = createKeyedSingleFlight<number>();
    const first = deferred<number>();
    let callbackPromise: Promise<number> | undefined;
    let taskPromise: Promise<number> | undefined;

    const owner = flight.runOwned(
      'k',
      () => {
        taskPromise = flight.runOwned('k', async () => 99).promise;
        return first.promise;
      },
      () => {
        callbackPromise = flight.runOwned('k', async () => 99).promise;
      },
    );

    expect(callbackPromise).toBe(owner.promise);
    await Promise.resolve();
    expect(taskPromise).toBe(owner.promise);

    first.resolve(7);
    await expect(owner.promise).resolves.toBe(7);
  });

  it('preserves task rejection and allows a fresh run afterward', async () => {
    const flight = createKeyedSingleFlight<number>();
    const failure = new Error('boom');
    const owner = flight.runOwned('k', async () => { throw failure; });
    const follower = flight.runOwned('k', async () => 99);

    await expect(owner.promise).rejects.toBe(failure);
    await expect(follower.promise).rejects.toBe(failure);
    await expect(flight.runOwned('k', async () => 42).promise).resolves.toBe(42);
  });

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

  async function expectCleanupRaceThroughRun(
    run: (key: string, task: () => Promise<number>) => Promise<number>,
  ) {
    const oldTask = deferred<number>();
    const newerTask = deferred<number>();
    const old = run('k', () => oldTask.promise);
    let interleaved: Promise<number> | undefined;

    void oldTask.promise.then(() => {
      interleaved = run('k', () => newerTask.promise);
    });

    oldTask.resolve(1);
    await expect(old).resolves.toBe(1);
    expect(interleaved).toBe(old);

    newerTask.resolve(2);
    await expect(interleaved).resolves.toBe(1);
    await expect(run('k', async () => 3)).resolves.toBe(3);
  }

  it('does not let stale cleanup delete a newer slot through run', async () => {
    const flight = createKeyedSingleFlight<number>();
    await expectCleanupRaceThroughRun((key, task) => flight.run(key, task));
  });

  it('does not let stale cleanup delete a newer slot through runOwned', async () => {
    const flight = createKeyedSingleFlight<number>();
    const runOwned = (key: string, task: () => Promise<number>) =>
      flight.runOwned(key, task).promise;
    await expectCleanupRaceThroughRun(runOwned);
  });
});
