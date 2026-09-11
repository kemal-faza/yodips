import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Uniform stale-session classification.
 *
 * Owns the typed stale error (matched by the poller/controllers), the
 * redirect-loop detector, the login-redirect heuristic, and the response
 * classifier that backs the transport's response consumption.
 */

/** Why an upstream response was classified as a stale session. */
export type UpstreamStaleReason =
  | 'redirect-loop'
  | 'http-not-ok'
  | 'login-redirect'
  | 'html-content-type'
  | 'malformed-json';

export type UpstreamSessionCheck = {
  valid: boolean;
  reason: 'ok' | 'no-cookie' | 'stale';
};

export type UpstreamFetchOutcome =
  | { kind: 'ok'; res: Response }
  | { kind: 'stale'; reason: UpstreamStaleReason; res?: Response };

/** How a service name renders inside user-facing messages ('Siap' → 'SIAP'). */
const SERVICE_DISPLAY: Record<string, string> = {
  Siap: 'SIAP',
  siap: 'SIAP',
  Kulon: 'Kulon',
  kulon: 'Kulon',
};

/**
 * Uniform stale-session error so controllers surface a friendly "login ulang"
 * prompt and the poller pushes its re-login notification.
 *
 * STATUS POLICY (fix relogin-loop): bukti sesi mati (login-redirect, no-cookie,
 * api-credential, …) tetap 401 — hanya re-login yang memperbaiki. Gangguan
 * upstream SEMENTARA (fetch-threw, api-endpoint, upstream 5xx) memakai 502
 * supaya klien tidak salah mengira sesinya mati dan terjebak loop re-login.
 */
export class StaleUpstreamError extends HttpException {
  /** Machine-readable why (see UpstreamStaleReason), for logs/diagnostics. */
  readonly reason: string;

  constructor(
    service: string,
    reason = 'stale',
    customMessage?: string,
    res?: Response,
  ) {
    const label = SERVICE_DISPLAY[service] ?? service;
    const message =
      customMessage ?? `Session ${label} expired. Silakan login ulang via SSO`;
    super({ message }, statusForStaleReason(reason, res));
    this.reason = reason;
  }
}

/** Reason codes whose failure is transient (upstream trouble, not the session). */
const TRANSIENT_STALE_REASONS = new Set(['fetch-threw', 'api-endpoint']);

/** 401 only for genuine dead-session evidence; 502 for transient upstream. */
function statusForStaleReason(reason: string, res?: Response): HttpStatus {
  if (TRANSIENT_STALE_REASONS.has(reason)) return HttpStatus.BAD_GATEWAY;
  if (
    reason === 'http-not-ok' &&
    res &&
    res.status >= HttpStatus.INTERNAL_SERVER_ERROR
  ) {
    return HttpStatus.BAD_GATEWAY;
  }
  return HttpStatus.UNAUTHORIZED;
}

/**
 * True bila error berasal dari sesi upstream stale (-> dorong re-login).
 * Matches any 401 HttpException so pre-existing throw sites (and the poller's
 * "Sesi belum ada") keep working; StaleUpstreamError is the canonical subtype.
 */
export function isStaleUpstreamError(e: unknown): boolean {
  return (
    e instanceof HttpException && e.getStatus() === HttpStatus.UNAUTHORIZED
  );
}

/**
 * True when the final URL landed on a login page: either upstream's own
 * login route or the Microsoft OIDC host both SSO flows funnel through.
 * Single source of truth replacing the three per-service regexes.
 */
export function isLoginRedirect(finalUrl?: string): boolean {
  if (!finalUrl) return false;
  if (/\/login(?:\/|$)/i.test(finalUrl)) return true;
  return /\/\/login\.microsoftonline\.com(?:\/|$)/i.test(finalUrl);
}

/** True when a fetch failure was undici's "redirect count exceeded" loop. */
export function isRedirectLoopCause(e: unknown): boolean {
  const cause = (e as Error | null | undefined)?.cause as
    string | Error | undefined | null;
  if (!cause) return false;
  const text = typeof cause === 'string' ? cause : (cause?.message ?? '');
  return /redirect count exceeded/i.test(text);
}

/** Classify an already completed response without performing network I/O. */
export function classifyUpstreamResponse(res: Response): UpstreamFetchOutcome {
  if (!res.ok) return { kind: 'stale', reason: 'http-not-ok', res };
  if (isLoginRedirect(res.url)) {
    return { kind: 'stale', reason: 'login-redirect', res };
  }
  return { kind: 'ok', res };
}
