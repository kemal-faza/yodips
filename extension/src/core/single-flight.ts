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
 */
export function createLifecycleCoordinator() {
  let epoch = 0;
  const queue = createSerialQueue();
  const handoffs = new Map<number, Promise<unknown>>();

  return {
    currentEpoch: () => epoch,
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
