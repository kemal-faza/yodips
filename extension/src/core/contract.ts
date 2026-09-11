export type Service = 'sso' | 'kulon' | 'siap';

export type FlowMode = 'auto' | 'semi';

export interface CookieFlags {
  hasSso: boolean;
  hasKulon: boolean;
  hasSiap: boolean;
}

export type OutboundStatus =
  | { status: 'ok'; accessToken: string }
  | { status: 'started'; mode: FlowMode; message?: string }
  | { status: 'error'; message: string };

export type InboundMessage =
  | { action: 'handoff' }
  | { action: 'ping' }
  | { action: 'logout' }
  | { action: 'status' }
  | { action: 'done' };

export interface HandoffRaw {
  ok: boolean;
  status: number;
  code?: string;
  reason?: string;
  message?: string;
  accessToken?: string;
  hasSso?: boolean;
  hasMicrosoft?: boolean;
  hasKulon?: boolean;
  hasSiap?: boolean;
}

/**
 * Backend error codes classified by the extension's handoff path (single
 * mirror; canonical source: `contract/backend-contract.json`, guarded by
 * `backend/src/common/contract-drift.spec.ts`). Only codes with a real branch
 * live here: the extension never presents a JWT (it POSTs already-captured
 * session cookies), so `INVALID_TOKEN`/`SESSION_DEAD` are unreachable and
 * unclassifiable codes fall through to a generic handoff error. The web client
 * mirrors its own subset in `web/src/api/contract.ts`, mobile in
 * `core/network/Contract.kt`.
 */
export const BACKEND_CODES = {
  /** Upstream Kulon session expired server-side → re-auth Kulon. */
  KULON_STALE: 'KULON_STALE',
  /** Handoff carried no Kulon cookie at all → send the user to Kulon login. */
  KULON_NO_COOKIE: 'KULON_NO_COOKIE',
  /** Upstream SIAP session expired server-side → re-auth SIAP. */
  SIAP_STALE: 'SIAP_STALE',
} as const;

export type BackendCode = keyof typeof BACKEND_CODES;