// backend/src/common/single-flight.ts
/**
 * In-flight dedup: N concurrent callers of `run` share ONE underlying
 * promise. The slot is cleared on settle (success OR error), so a caller
 * after completion starts fresh. No TTL here — TTL belongs to DataCache.
 */
export class SingleFlight<T> {
  private inFlight?: Promise<T>;

  run(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = fn().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
}

export interface OwnedFlight<T> {
  owner: boolean;
  promise: Promise<T>;
}

export interface KeyedSingleFlight<T> {
  run(key: string, task: () => Promise<T>): Promise<T>;
  runOwned(
    key: string,
    task: () => Promise<T>,
    onOwnerStart?: () => void,
  ): OwnedFlight<T>;
}

/** Keyed variant: one identity-safe slot per key, removed on settle. */
export function createKeyedSingleFlight<T>(): KeyedSingleFlight<T> {
  type Slot = { promise: Promise<T> };
  const flights = new Map<string, Slot>();

  const runOwned = (
    key: string,
    task: () => Promise<T>,
    onOwnerStart?: () => void,
  ): OwnedFlight<T> => {
    const active = flights.get(key);
    if (active) return { owner: false, promise: active.promise };

    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const slot: Slot = {
      promise: new Promise<T>((ok, fail) => {
        resolve = ok;
        reject = fail;
      }),
    };
    flights.set(key, slot);
    onOwnerStart?.();
    Promise.resolve()
      .then(task)
      .finally(() => {
        if (flights.get(key) === slot) flights.delete(key);
      })
      .then(resolve, reject);
    return { owner: true, promise: slot.promise };
  };

  return {
    run: (key, task) => runOwned(key, task).promise,
    runOwned,
  };
}
