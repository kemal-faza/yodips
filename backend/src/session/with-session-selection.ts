import { StaleUpstreamError } from '../upstream/stale-classification';
import type { SessionRef } from './session-contract';
import type { SessionStore } from './session-store';

/** Upper bound mirrors SESSION_MAX_PER_USER; one NIM never has more devices. */
const MAX_CANDIDATES = 10;

/**
 * Background-only selection seam: run `attempt` against the user's live device
 * records, newest capture first, until one of them works.
 *
 * Only a `StaleUpstreamError` is retried: that is the one failure that says
 * "this particular device cannot serve the request", so the next live device
 * may still succeed. Any other error (network, upstream 5xx, programming bug)
 * is rethrown immediately — retrying it would multiply the mistake across
 * every device and hide the real cause.
 *
 * When no session exists the caller supplies `onEmpty` (usually a stale-typed
 * error so the poller still pushes its re-login notification). When every
 * candidate is stale the LAST stale error is thrown, preserving the most
 * recent failure for the caller's classification.
 */
export async function withFirstLive<T>(
  store: SessionStore,
  sub: string,
  attempt: (ref: SessionRef) => Promise<T>,
  onEmpty: () => Error,
): Promise<T> {
  const sessions = [...(await store.listBySub(sub))]
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, MAX_CANDIDATES);
  let last: unknown;
  for (const session of sessions) {
    const ref: SessionRef = {
      sub,
      clientId: session.clientId,
      sessionGeneration: session.sessionGeneration,
    };
    try {
      return await attempt(ref);
    } catch (error) {
      if (!(error instanceof StaleUpstreamError)) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : onEmpty();
}
