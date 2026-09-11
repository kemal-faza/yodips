/**
 * Public barrel for the upstream seam.
 *
 * The seam is split into four focused modules:
 *  - `./timed-transport`      — the one timed fetch + response pipeline
 *  - `./stale-classification` — stale error + classification helpers
 *  - `./route-inventory`      — route context/attempt validation
 *  - `./telemetry-events`     — event shaping + transport-reason side-channel
 *
 * Re-exported here so every existing caller (and spec) keeps importing the
 * same names from `./upstream-fetch`.
 */
export type {
  UpstreamStaleReason,
  UpstreamSessionCheck,
  UpstreamFetchOutcome,
} from './stale-classification';
export {
  StaleUpstreamError,
  isStaleUpstreamError,
  isLoginRedirect,
  isRedirectLoopCause,
  classifyUpstreamResponse,
} from './stale-classification';

export type { UpstreamRouteContext } from './route-inventory';
export { validateUpstreamAttempt } from './route-inventory';

export { getTimedFetchTransportReason } from './telemetry-events';

export type {
  UpstreamAttemptResult,
  UpstreamFetchOpts,
} from './timed-transport';
export {
  timedFetch,
  upstreamFetchText,
  upstreamFetchJson,
} from './timed-transport';
