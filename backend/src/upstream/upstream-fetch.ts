import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * One seam for authenticated upstream (SIAP/Kulon) session plumbing.
 *
 * Owns the three things every caller previously re-implemented:
 *  - stale classification (`classifyUpstreamFetch`, `probeUpstreamSession`)
 *  - authenticated fetch returning text/JSON (`upstreamFetchText/Json`)
 *  - the uniform typed error (`StaleUpstreamError`) the poller and controllers
 *    match on instead of "any 401".
 *
 * Pure transport policy: no cookies/sesskeys are resolved here (adapters in
 * kulon/siap hold their upstream's specifics), and no parsing happens here.
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
  | {
      kind: 'stale';
      reason: UpstreamStaleReason;
      res?: Response;
      /** Set on redirect-loop: the underlying fetch error (for evidence logs). */
      error?: unknown;
    }
  | { kind: 'gateway'; reason: 'fetch-threw'; networkMessage?: string };

/** How a service name renders inside user-facing messages ('Siap' → 'SIAP'). */
const SERVICE_DISPLAY: Record<string, string> = { Siap: 'SIAP' };

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
    | string
    | Error
    | undefined
    | null;
  if (!cause) return false;
  const text =
    typeof cause === 'string' ? cause : ((cause as Error)?.message ?? '');
  return /redirect count exceeded/i.test(text);
}

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
 * Fetch an upstream URL and classify the result WITHOUT deciding policy:
 * callers map each shape onto their own stale/gateway semantics.
 */
export async function classifyUpstreamFetch(
  url: string,
  init?: RequestInit,
): Promise<UpstreamFetchOutcome> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isRedirectLoopCause(e)) {
      return { kind: 'stale', reason: 'redirect-loop', error: e };
    }
    return {
      kind: 'gateway',
      reason: 'fetch-threw',
      networkMessage: (e as Error)?.message,
    };
  }
  if (!res.ok) return { kind: 'stale', reason: 'http-not-ok', res };
  if (isLoginRedirect(res.url)) {
    return { kind: 'stale', reason: 'login-redirect', res };
  }
  return { kind: 'ok', res };
}

export interface UpstreamFetchOpts {
  /** Overrides the 401 message for the http-not-ok shape (e.g. Kulon "gangguan"). */
  notOkMessage?: string;
  /** Diagnostics hook fired right before the stale error is thrown. */
  onStale?: (reason: string, res: Response | null, extra?: string) => void;
}

/** Throw the uniform stale error after reporting evidence. */
function throwStale(
  service: string,
  reason: UpstreamStaleReason | 'fetch-threw',
  opts: UpstreamFetchOpts | undefined,
  res: Response | null,
  extra?: string,
  notOkMessage?: string,
): never {
  opts?.onStale?.(reason, res, extra);
  throw new StaleUpstreamError(service, reason, notOkMessage, res ?? undefined);
}

/**
 * Fetch an upstream page and return the body text. Any non-ok response,
 * login redirect, or network failure maps to StaleUpstreamError (401).
 */
export async function upstreamFetchText(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<string> {
  const outcome = await classifyUpstreamFetch(url, init);
  if (outcome.kind === 'ok') return outcome.res.text();
  if (outcome.kind === 'gateway') {
    throwStale(service, outcome.reason, opts, null, outcome.networkMessage);
  }
  throwStale(
    service,
    outcome.reason,
    opts,
    outcome.res ?? null,
    undefined,
    outcome.reason === 'http-not-ok' ? opts?.notOkMessage : undefined,
  );
}

/**
 * Fetch an upstream AJAX endpoint and return the parsed JSON body. Tries
 * `res.json()` FIRST: real SIAP serves valid JSON behind a misleading
 * `text/html` content-type, so content-type alone would mislabel a working
 * session as expired. Only when parsing fails do we use the body shape
 * (content-type + preview) to decide html-content-type vs malformed-json —
 * both map to StaleUpstreamError.
 */
export async function upstreamFetchJson<T = unknown>(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<T> {
  const outcome = await classifyUpstreamFetch(url, init);
  if (outcome.kind === 'gateway') {
    throwStale(service, outcome.reason, opts, null, outcome.networkMessage);
  }
  if (outcome.kind === 'stale') {
    throwStale(
      service,
      outcome.reason,
      opts,
      outcome.res ?? null,
      undefined,
      outcome.reason === 'http-not-ok' ? opts?.notOkMessage : undefined,
    );
  }
  const res = outcome.res;
  // Tee the body so we can preview it if parsing fails (res.json consumes the
  // original stream first).
  let previewTee: Response | null = null;
  try {
    previewTee = res.clone();
  } catch {
    previewTee = null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    const contentType = res.headers.get('content-type') ?? '';
    const preview = await readHtmlPreview(previewTee);
    const reason: UpstreamStaleReason = /text\/html/i.test(contentType)
      ? 'html-content-type'
      : 'malformed-json';
    throwStale(service, reason, opts, res, `${contentType} body=${preview}`);
  }
}

/**
 * Read the first ~160 chars of an HTML body (tags stripped) for stale-evidence
 * logs. Only safe while the tee'd response is unconsumed.
 */
async function readHtmlPreview(res: Response | null): Promise<string> {
  try {
    if (!res || typeof res.clone !== 'function') return 'no-preview';
    const body = await res.clone().text();
    return truncate(
      body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      160,
    );
  } catch {
    return 'unreadable';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export interface ProbeUpstreamSessionInput {
  url: string;
  cookie: string;
  /** Service name used in error messages (unused on the boolean path). */
  service: string;
  /** Fingerprint of an AUTHENTICATED page (e.g. sesskey/profile marker). */
  isAuthenticatedPage: (finalUrl: string, html: string) => boolean;
  /** Override for the missing-marker evidence line (service-specific wording). */
  missingMarkerEvidence?: string;
  /** Diagnostics hook with the exact human-readable evidence line. */
  onEvidence?: (evidence: string, context: unknown) => void;
}

/**
 * Single source of truth for upstream session validity. A real session makes
 * the probe URL render a page satisfying `isAuthenticatedPage`; everything
 * else (network loop, non-ok, login redirect, missing marker) maps to
 * `stale` without throwing. Empty cookie short-circuits with `no-cookie`.
 */
export async function probeUpstreamSession(
  input: ProbeUpstreamSessionInput,
): Promise<UpstreamSessionCheck> {
  if (!input.cookie) return { valid: false, reason: 'no-cookie' };
  const outcome = await classifyUpstreamFetch(input.url, {
    headers: { Cookie: input.cookie },
    redirect: 'follow',
  });
  switch (outcome.kind) {
    case 'gateway':
      // Generic network noise: stay silent (matches existing per-service probes).
      return { valid: false, reason: 'stale' };
    case 'stale': {
      if (outcome.reason === 'redirect-loop') {
        input.onEvidence?.('redirect loop', outcome.error);
      } else if (outcome.reason === 'http-not-ok') {
        input.onEvidence?.(`http ${outcome.res?.status}`, outcome.res ?? null);
      } else if (outcome.reason === 'login-redirect') {
        input.onEvidence?.(
          `redirected to ${outcome.res?.url}`,
          outcome.res ?? null,
        );
      }
      return { valid: false, reason: 'stale' };
    }
    case 'ok': {
      const html = await outcome.res.text();
      if (!input.isAuthenticatedPage(outcome.res.url, html)) {
        input.onEvidence?.(
          input.missingMarkerEvidence ?? 'page missing sesskey (login redirect)',
          outcome.res,
        );
        return { valid: false, reason: 'stale' };
      }
      return { valid: true, reason: 'ok' };
    }
  }
}
