import { clearCache } from '../api/cache';

/**
 * The one owner of the session generation and the logout gate.
 *
 * Two independent things live here:
 *  - the **session generation** (`epoch()`) — a monotonic counter advanced
 *    whenever the session is wiped (`advance()`, `wipeSession()`), so an
 *    in-flight outcome stamped with an older generation can be recognized as
 *    belonging to a dead session;
 *  - the **logout gate** (`begin()`/`end()`, ref-counted) — raised for the
 *    duration of a logout so sibling 401s, refresh flights and reauth polls
 *    stand down.
 *
 * `isCurrent(e)` combines both: an outcome is still owned iff its stamp matches
 * the live generation AND no logout is in flight. Callers keep their own
 * attempt/flow id for "this click superseded that click" — that is a different,
 * purely local generation (see CONTEXT.md).
 *
 * `wipeSession()` coordinates the session generation with the data-cache
 * generation so a full wipe advances both together. It is storage-agnostic:
 * the cache is injected via `onWipe` (defaults to `clearCache`).
 */
export interface SessionLifetime {
  /** Current session generation (monotonic). */
  epoch(): number;
  /** True iff `epoch` is the live generation and no logout is in flight. */
  isCurrent(epoch: number): boolean;
  /** Raised while a logout owns the session teardown. */
  isLogoutInProgress(): boolean;
  /** Raise the gate (ref-counted). Does not move the generation. */
  begin(): void;
  /** Release the gate (ref-counted); never negative. */
  end(): void;
  /** Advance the session generation without touching the gate. */
  advance(): void;
  /** Advance the session generation and run the coordinated cache wipe. */
  wipeSession(): void;
}

export interface SessionLifetimeOptions {
  /** Side effect of a full wipe; defaults to clearing the data cache. */
  onWipe?: () => void;
}

export function createSessionLifetime(opts: SessionLifetimeOptions = {}): SessionLifetime {
  let inFlight = 0;
  let generation = 0;
  const onWipe = opts.onWipe ?? clearCache;

  return {
    epoch: () => generation,
    isCurrent: (epoch) => epoch === generation && inFlight === 0,
    isLogoutInProgress: () => inFlight > 0,
    begin: () => {
      inFlight += 1;
    },
    end: () => {
      if (inFlight > 0) inFlight -= 1;
    },
    advance: () => {
      generation += 1;
    },
    wipeSession: () => {
      generation += 1;
      onWipe();
    },
  };
}

/** Production instance: one session generation for the app, wiping the cache. */
export const sessionLifetime = createSessionLifetime();
