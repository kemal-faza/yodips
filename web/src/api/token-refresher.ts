import { getReauthEpoch } from '../lib/logout';

export type RawRefresh = () => Promise<string>;

/**
 * Single-flight token refresher: concurrent 401s share ONE in-flight
 * `POST /api/auth/refresh` instead of each minting its own token against a
 * globally rate-limited backend. Semantics mirror the mobile client's
 * `SsoRepository.inflightRefresh` (one Deferred shared by all waiters):
 * the first caller starts the request, everyone else awaits the same
 * promise; the flight clears on settle (success OR failure) so a later
 * caller always gets a fresh attempt.
 *
 * Reauth-epoch ownership (reviewer B): the flight is keyed by the epoch
 * captured at creation. An E1 waiter arriving after a logout that fully
 * resolved (epoch bumped, flag down) while an E0 flight is still pending must
 * NEVER join or accept the orphaned E0 flight — it starts its OWN refresh.
 * Cleanup is identity-guarded so an orphaned E0 finally cannot clear the
 * newer E1 flight. Same-epoch waiters still share one flight (no regression).
 */
export function createTokenRefresher(rawRefresh: RawRefresh): () => Promise<string> {
  let inflight: { epoch: number; promise: Promise<string> } | null = null;
  return function refreshOnce(): Promise<string> {
    const cur = getReauthEpoch();
    if (inflight && inflight.epoch === cur) {
      return inflight.promise;
    }
    // No flight, or the stored flight belongs to an older epoch (orphaned by a
    // logout that crossed it): start a fresh flight for the current epoch.
    // The orphaned flight's finally is identity-guarded below and cannot clear
    // this newer record.
    let raw: Promise<string>;
    try {
      raw = rawRefresh();
    } catch (e) {
      return Promise.reject(e);
    }
    const record: { epoch: number; promise: Promise<string> } = {
      epoch: cur,
      promise: null as unknown as Promise<string>,
    };
    record.promise = raw.finally(() => {
      if (inflight === record) inflight = null;
    });
    inflight = record;
    return record.promise;
  };
}
