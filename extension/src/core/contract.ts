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
 * Backend error codes (single mirror; source of truth:
 * backend/src/auth/auth.service.ts). The web client mirrors the same set in
 * `web/src/api/contract.ts`, mobile in `core/network/Contract.kt`.
 */
export const BACKEND_CODES = {
  /** Upstream Kulon session expired server-side. */
  KULON_STALE: 'KULON_STALE',
  /** Upstream SIAP session expired server-side. */
  SIAP_STALE: 'SIAP_STALE',
  /** JWT failed validation (bad/expired token). */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** Server-side session record is gone — re-login required. */
  SESSION_DEAD: 'SESSION_DEAD',
} as const;

export type BackendCode = keyof typeof BACKEND_CODES;