/** Run only one async operation at a time and share its result with joiners. */
export function createSingleFlight<T>() {
  let active: Promise<T> | null = null;

  return (task: () => Promise<T>): Promise<T> => {
    if (active) return active;

    const flight = Promise.resolve().then(task);
    const joined = flight.finally(() => {
      if (active === joined) active = null;
    });
    active = joined;
    return joined;
  };
}

/** Run asynchronous lifecycle operations sequentially, continuing after failure. */
export function createSerialQueue() {
  let tail = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * Coordinate lifecycle operations and keep handoff single-flight per logout
 * epoch, so a post-logout login cannot join a cancelled pre-logout promise.
 *
 * PERSISTENCE (MV3 service-worker restart): the epoch is what tags every
 * cached handoff result. The SW can be killed mid-logout; on restart the
 * in-memory epoch would reset to 0 while a pre-restart, untagged result still
 * sits in `chrome.storage.session` — the SPA's status poll would then recover
 * a stale token after a logout that never finished. The background adapter
 * therefore persists the epoch in `storage.session` next to the cached result
 * and calls `restoreEpoch` on start (idle only), so a restart is fenced the
 * same way an in-process logout is.
 */
export function createLifecycleCoordinator() {
  let epoch = 0;
  const queue = createSerialQueue();
  const handoffs = new Map<number, Promise<unknown>>();

  return {
    currentEpoch: () => epoch,
    /** Adopt a persisted epoch on SW start. Only meaningful while idle. */
    restoreEpoch: (persisted: number) => {
      if (Number.isSafeInteger(persisted) && persisted > epoch) {
        epoch = persisted;
      }
    },
    invalidate: () => ++epoch,
    beginHandoff: () => {
      if (handoffs.has(epoch)) return epoch;
      return ++epoch;
    },
    enqueue: queue,
    handoff<T>(requestEpoch: number, task: () => Promise<T>): Promise<T> {
      const existing = handoffs.get(requestEpoch);
      if (existing) return existing as Promise<T>;

      const run = queue(task);
      const tracked = run.finally(() => {
        if (handoffs.get(requestEpoch) === tracked) handoffs.delete(requestEpoch);
      });
      handoffs.set(requestEpoch, tracked);
      return tracked;
    },
  };
}
