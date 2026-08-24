export type RawRefresh = () => Promise<string>;

/**
 * Single-flight token refresher: concurrent 401s share ONE in-flight
 * `POST /api/auth/refresh` instead of each minting its own token against a
 * globally rate-limited backend. Semantics mirror the mobile client's
 * `SsoRepository.inflightRefresh` (one Deferred shared by all waiters):
 * the first caller starts the request, everyone else awaits the same
 * promise; the flight clears on settle (success OR failure) so a later
 * caller always gets a fresh attempt.
 */
export function createTokenRefresher(rawRefresh: RawRefresh): () => Promise<string> {
  let inflight: Promise<string> | null = null;
  return function refreshOnce(): Promise<string> {
    if (!inflight) {
      inflight = rawRefresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}
