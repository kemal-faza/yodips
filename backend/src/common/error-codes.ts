/**
 * Typed view of the canonical backend contract (`contract/backend-contract.json`).
 * The JSON is the single source; this table must equal its `errorCodes` list —
 * `contract-drift.spec.ts` fails if they diverge. Clients mirror subsets of
 * these codes (see the spec for the per-client guard).
 */
export const ERROR_CODES = {
  KULON_NO_COOKIE: 'KULON_NO_COOKIE',
  KULON_STALE: 'KULON_STALE',
  SIAP_STALE: 'SIAP_STALE',
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_DEAD: 'SESSION_DEAD',
  INVALID_CODE: 'INVALID_CODE',
  EXPIRED_CODE: 'EXPIRED_CODE',
  IDENTITY_UNRESOLVED: 'IDENTITY_UNRESOLVED',
  WEB_PUSH_CAP_REACHED: 'WEB_PUSH_CAP_REACHED',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
