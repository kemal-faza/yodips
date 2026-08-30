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

/** Keyed variant: one SingleFlight per key, entry removed on settle. */
export function createKeyedSingleFlight<T>(): {
  run(key: string, fn: () => Promise<T>): Promise<T>;
} {
  const map = new Map<string, SingleFlight<T>>();
  return {
    run(key: string, fn: () => Promise<T>): Promise<T> {
      let sf = map.get(key);
      if (!sf) {
        sf = new SingleFlight<T>();
        map.set(key, sf);
      }
      return sf.run(fn).finally(() => {
        map.delete(key);
      });
    },
  };
}
