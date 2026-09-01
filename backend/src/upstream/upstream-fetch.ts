import { HttpException, HttpStatus } from '@nestjs/common';
import {
  elapsedMs,
  recordTelemetry,
  type TelemetryRuntime,
} from '../observability/telemetry';
import {
  UPSTREAM_HTTP_ERROR_REASONS,
  UPSTREAM_NETWORK_ERROR_REASONS,
  UPSTREAM_PARSE_ERROR_REASONS,
  UPSTREAM_ROUTES,
  UPSTREAM_STALE_REASONS,
  type UpstreamReason,
  type UpstreamRequestEventInput,
  type UpstreamRoute,
} from '../observability/telemetry-contract';

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
 * kulon/siap hold their upstream's specifics); response consumption is supplied
 * by each timed attempt's consumer.
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
    }
  | {
      kind: 'gateway';
      reason: 'fetch-threw';
      /** Type-only compatibility; transport messages are never retained. */
      networkMessage?: undefined;
    };

export type UpstreamRouteContext = UpstreamRoute & {
  /** Required by the Microsoft token route; never included in telemetry. */
  tenantId?: string;
};

export type UpstreamAttemptResult<T> =
  | { ok: true; value: T; outcome: 'ok'; status?: number }
  | {
      ok: false;
      error?: unknown;
      outcome: 'http_error' | 'parse_error' | 'stale';
      reason?: UpstreamReason;
      status?: number;
    };

type TimedFetchTransportReason = 'fetch-threw' | 'redirect-loop';

const transportReasons = new WeakMap<object, TimedFetchTransportReason>();

const UPSTREAM_ORIGINS: Readonly<Record<UpstreamRoute['service'], string>> = {
  kulon: 'https://kulon2.undip.ac.id',
  siap: 'https://siap.undip.ac.id',
  'siap-api': 'https://api.siap.undip.ac.id',
  sso: 'https://sso.undip.ac.id',
  microsoft: 'https://login.microsoftonline.com',
};

const MICROSOFT_TENANT_SEGMENT =
  /^(?:common|organizations|consumers|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/i;

function microsoftTokenPath(tenantId: unknown): string {
  if (
    typeof tenantId !== 'string' ||
    !MICROSOFT_TENANT_SEGMENT.test(tenantId)
  ) {
    throw new TypeError('Invalid Microsoft tenant path');
  }
  return `/${tenantId}/oauth2/v2.0/token`;
}

function rawPathname(url: string): string {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return '';
  const pathStart = url.indexOf('/', schemeEnd + 3);
  if (pathStart < 0) return '/';
  const queryStart = url.indexOf('?', pathStart);
  const fragmentStart = url.indexOf('#', pathStart);
  const pathEnd =
    queryStart < 0
      ? fragmentStart < 0
        ? url.length
        : fragmentStart
      : fragmentStart < 0
        ? queryStart
        : Math.min(queryStart, fragmentStart);
  return url.slice(pathStart, pathEnd);
}

export function getTimedFetchTransportReason(
  error: unknown,
): TimedFetchTransportReason | undefined {
  return typeof error === 'object' && error !== null
    ? transportReasons.get(error)
    : undefined;
}

/** How a service name renders inside user-facing messages ('Siap' → 'SIAP'). */
const SERVICE_DISPLAY: Record<string, string> = {
  Siap: 'SIAP',
  siap: 'SIAP',
  Kulon: 'Kulon',
  kulon: 'Kulon',
};

function fixedRoute(
  service: UpstreamRoute['service'],
  operation: UpstreamRoute['operation'],
  route: UpstreamRoute['route'],
): UpstreamRouteContext {
  const candidate = UPSTREAM_ROUTES.find(
    (item) =>
      item.service === service &&
      item.operation === operation &&
      item.route === route,
  );
  if (!candidate) throw new Error('Invalid upstream route inventory');
  return Object.freeze({ ...candidate });
}

export const KULON_SESSION_PROBE = fixedRoute(
  'kulon',
  'session_probe',
  'GET /my/',
);

export const SIAP_SESSION_PROBE = fixedRoute(
  'siap',
  'session_probe',
  'GET /pages/mhs/dashboard',
);

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

/** Classify an already completed response without performing network I/O. */
export function classifyUpstreamResponse(res: Response): UpstreamFetchOutcome {
  if (!res.ok) return { kind: 'stale', reason: 'http-not-ok', res };
  if (isLoginRedirect(res.url)) {
    return { kind: 'stale', reason: 'login-redirect', res };
  }
  return { kind: 'ok', res };
}

/**
 * Compatibility wrapper for owners that have not migrated to timedFetch yet.
 * New code must classify the response inside timedFetch's consumer.
 */
export async function classifyUpstreamFetch(
  url: string,
  init?: RequestInit,
): Promise<UpstreamFetchOutcome> {
  try {
    return classifyUpstreamResponse(await fetch(url, init));
  } catch (e) {
    const reason = isRedirectLoopCause(e) ? 'redirect-loop' : 'fetch-threw';
    if (typeof e === 'object' && e !== null) transportReasons.set(e, reason);
    if (reason === 'redirect-loop') {
      return { kind: 'stale', reason };
    }
    return { kind: 'gateway', reason };
  }
}

export interface UpstreamFetchOpts {
  /** Overrides the 401 message for the http-not-ok shape (e.g. Kulon "gangguan"). */
  notOkMessage?: string;
  /** Compatibility diagnostics hook; only bounded reason evidence is supplied. */
  onStale?: (
    reason: string,
    res: Response | null,
    extra?: string,
  ) => void | PromiseLike<void>;
}

/** Validate a fixed inventory route and the URL path before any fetch occurs. */
export function validateUpstreamAttempt(
  context: UpstreamRouteContext,
  url: string,
  method: string,
): UpstreamRouteContext {
  if (!context || typeof context !== 'object') {
    throw new TypeError('Invalid upstream route context');
  }
  const canonical = UPSTREAM_ROUTES.find(
    (candidate) =>
      candidate.service === context.service &&
      candidate.operation === context.operation &&
      candidate.route === context.route,
  );
  if (!canonical) throw new TypeError('Invalid upstream route context');

  if (typeof url !== 'string') {
    throw new TypeError('Invalid upstream request URL');
  }
  if (typeof method !== 'string') {
    throw new TypeError('Invalid upstream request method');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('Invalid upstream request URL');
  }
  const [expectedMethod, canonicalPath] = canonical.route.split(' ');
  const expectedPath =
    canonical.service === 'microsoft' &&
    canonical.operation === 'token_exchange'
      ? microsoftTokenPath(context.tenantId)
      : canonicalPath;
  const pathMatches =
    canonical.service === 'microsoft' && canonical.operation === 'token_exchange'
      ? rawPathname(url) === expectedPath && parsed.pathname === expectedPath
      : parsed.pathname === expectedPath;
  if (method.toUpperCase() !== expectedMethod || !pathMatches) {
    throw new TypeError('Upstream URL does not match route context');
  }
  if (parsed.origin !== UPSTREAM_ORIGINS[canonical.service]) {
    throw new TypeError('Upstream URL origin is not allowed');
  }
  return canonical;
}

function safeStart(runtime: TelemetryRuntime): bigint {
  try {
    const value = runtime.monotonicNowNs();
    return typeof value === 'bigint' ? value : 0n;
  } catch {
    return 0n;
  }
}

function safeDuration(runtime: TelemetryRuntime, started: bigint): number {
  try {
    const ended = runtime.monotonicNowNs();
    return typeof ended === 'bigint' ? elapsedMs(started, ended) : 0;
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasReason<T extends readonly string[]>(
  reason: unknown,
  allowed: T,
): reason is T[number] {
  return typeof reason === 'string' && (allowed as readonly string[]).includes(reason);
}

function normalizeAttemptResult(
  value: unknown,
): UpstreamAttemptResult<unknown> {
  if (!isRecord(value)) throw new Error('Invalid upstream attempt result');
  if (value.ok === true && value.outcome === 'ok' && 'value' in value) {
    return value as UpstreamAttemptResult<unknown>;
  }
  if (
    value.ok === false &&
    (value.outcome === 'http_error' ||
      value.outcome === 'parse_error' ||
      value.outcome === 'stale')
  ) {
    return value as UpstreamAttemptResult<unknown>;
  }
  throw new Error('Invalid upstream attempt result');
}

function responseStatus(responseStatus: number, consumerStatus?: number): number {
  if (consumerStatus !== undefined && consumerStatus !== responseStatus) {
    throw new Error('Upstream response status mismatch');
  }
  return Number.isSafeInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
    ? responseStatus
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function terminalUpstreamEvent(
  context: UpstreamRouteContext,
  result: UpstreamAttemptResult<unknown>,
  status: number,
  durationMs: number,
): UpstreamRequestEventInput {
  const base = {
    event: 'upstream.request' as const,
    service: context.service,
    operation: context.operation,
    route: context.route,
    durationMs,
  };
  if (result.outcome === 'ok') {
    return { ...base, outcome: 'ok', status } as UpstreamRequestEventInput;
  }
  if (result.outcome === 'http_error') {
    return {
      ...base,
      outcome: 'http_error',
      status,
      reason: UPSTREAM_HTTP_ERROR_REASONS[0],
    } as UpstreamRequestEventInput;
  }
  if (result.outcome === 'parse_error') {
    const reason = hasReason(result.reason, UPSTREAM_PARSE_ERROR_REASONS)
      ? result.reason
      : 'unknown';
    return {
      ...base,
      outcome: 'parse_error',
      status,
      reason,
    } as UpstreamRequestEventInput;
  }
  const reason = hasReason(result.reason, UPSTREAM_STALE_REASONS)
    ? result.reason
    : 'unknown';
  return { ...base, outcome: 'stale', status, reason } as UpstreamRequestEventInput;
}

function parseUnknownEvent(
  context: UpstreamRouteContext,
  status: number,
  durationMs: number,
): UpstreamRequestEventInput {
  return {
    event: 'upstream.request',
    service: context.service,
    operation: context.operation,
    route: context.route,
    outcome: 'parse_error',
    status: responseStatus(status),
    reason: 'unknown',
    durationMs,
  } as UpstreamRequestEventInput;
}

function networkEvent(
  context: UpstreamRouteContext,
  reason: TimedFetchTransportReason,
  durationMs: number,
): UpstreamRequestEventInput {
  return {
    event: 'upstream.request',
    service: context.service,
    operation: context.operation,
    route: context.route,
    outcome: 'network_error',
    reason: UPSTREAM_NETWORK_ERROR_REASONS.includes(reason) ? reason : 'fetch-threw',
    durationMs,
  } as UpstreamRequestEventInput;
}

/**
 * Execute one upstream network attempt and record exactly one terminal event.
 * Response consumption is deliberately part of the attempt so parse/stale
 * outcomes cannot be recorded separately from their transport.
 */
export async function timedFetch<T>(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  init: RequestInit | undefined,
  consume: (response: Response) => Promise<UpstreamAttemptResult<T>>,
): Promise<T> {
  const canonical = validateUpstreamAttempt(context, url, init?.method ?? 'GET');
  const started = safeStart(runtime);
  let response: Response | undefined;
  let responseReceived = false;
  let terminalRecorded = false;

  try {
    response = await fetch(url, init);
    responseReceived = true;
    const result = normalizeAttemptResult(await consume(response));
    const status = responseStatus(response.status, result.status);
    recordTelemetry(
      runtime,
      terminalUpstreamEvent(canonical, result, status, safeDuration(runtime, started)),
    );
    terminalRecorded = true;
    if (result.ok) return result.value as T;
    throw result.error ?? new Error('Upstream attempt failed');
  } catch (error) {
    if (responseReceived) {
      if (!terminalRecorded) {
        recordTelemetry(
          runtime,
          parseUnknownEvent(
            canonical,
            response?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
            safeDuration(runtime, started),
          ),
        );
        terminalRecorded = true;
      }
      throw error;
    }

    const reason = isRedirectLoopCause(error) ? 'redirect-loop' : 'fetch-threw';
    if (typeof error === 'object' && error !== null) transportReasons.set(error, reason);
    recordTelemetry(runtime, networkEvent(canonical, reason, safeDuration(runtime, started)));
    throw error;
  }
}

function notifyStale(
  opts: UpstreamFetchOpts | undefined,
  reason: string,
): void {
  try {
    const result = opts?.onStale?.(reason, null, undefined);
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Compatibility diagnostics must never replace the stale upstream error.
  }
}

function responseFailure(
  service: string,
  res: Response,
  opts: UpstreamFetchOpts | undefined,
): UpstreamAttemptResult<never> | undefined {
  const outcome = classifyUpstreamResponse(res);
  if (outcome.kind === 'ok') return undefined;
  notifyStale(opts, outcome.reason);
  return {
    ok: false,
    error: new StaleUpstreamError(
      service,
      outcome.reason,
      outcome.reason === 'http-not-ok' ? opts?.notOkMessage : undefined,
      res,
    ),
    outcome: outcome.reason === 'http-not-ok' ? 'http_error' : 'stale',
    reason: outcome.reason,
    status: res.status,
  };
}

async function consumeText(
  res: Response,
  service: string,
  opts: UpstreamFetchOpts | undefined,
): Promise<UpstreamAttemptResult<string>> {
  const failure = responseFailure(service, res, opts);
  if (failure) return failure;
  return { ok: true, value: await res.text(), outcome: 'ok', status: res.status };
}

async function consumeJson<T>(
  res: Response,
  service: string,
  opts: UpstreamFetchOpts | undefined,
): Promise<UpstreamAttemptResult<T>> {
  const failure = responseFailure(service, res, opts);
  if (failure) return failure;
  try {
    return { ok: true, value: (await res.json()) as T, outcome: 'ok', status: res.status };
  } catch {
    const reason: UpstreamStaleReason = /text\/html/i.test(
      res.headers.get('content-type') ?? '',
    )
      ? 'html-content-type'
      : 'malformed-json';
    notifyStale(opts, reason);
    return {
      ok: false,
      error: new StaleUpstreamError(service, reason, undefined, res),
      outcome: 'parse_error',
      reason,
      status: res.status,
    };
  }
}

function isTelemetryRuntime(value: unknown): value is TelemetryRuntime {
  return (
    isRecord(value) &&
    isRecord(value.sink) &&
    typeof value.monotonicNowNs === 'function'
  );
}

function isFetchOpts(value: unknown): value is UpstreamFetchOpts {
  return isRecord(value) && ('notOkMessage' in value || 'onStale' in value);
}

function splitHelperArgs(
  initOrOpts: RequestInit | UpstreamFetchOpts | undefined,
  opts: UpstreamFetchOpts | undefined,
): { init: RequestInit | undefined; opts: UpstreamFetchOpts | undefined } {
  return isFetchOpts(initOrOpts)
    ? { init: undefined, opts: initOrOpts }
    : { init: initOrOpts, opts };
}

/** New timed signature plus the pre-Task-5 compatibility signature. */
export function upstreamFetchText(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  initOrOpts?: RequestInit | UpstreamFetchOpts,
  opts?: UpstreamFetchOpts,
): Promise<string>;
export function upstreamFetchText(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<string>;
export function upstreamFetchText(
  runtimeOrUrl: TelemetryRuntime | string,
  contextOrInit: UpstreamRouteContext | RequestInit | undefined,
  urlOrService: string,
  initOrOpts?: RequestInit | UpstreamFetchOpts,
  opts?: UpstreamFetchOpts,
): Promise<string> {
  if (isTelemetryRuntime(runtimeOrUrl)) {
    const args = splitHelperArgs(initOrOpts, opts);
    const context = contextOrInit as UpstreamRouteContext;
    return timedFetch(
      runtimeOrUrl,
      context,
      urlOrService,
      args.init,
      (res) =>
        consumeText(res, SERVICE_DISPLAY[context.service] ?? context.service, args.opts),
    );
  }
  return legacyFetchText(
    runtimeOrUrl,
    contextOrInit as RequestInit | undefined,
    urlOrService,
    initOrOpts as UpstreamFetchOpts | undefined,
  );
}

async function legacyFetchText(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<string> {
  const outcome = await classifyUpstreamFetch(url, init);
  if (outcome.kind === 'ok') return outcome.res.text();
  if (outcome.kind === 'gateway') throwStale(service, outcome.reason, opts, null);
  throwStale(
    service,
    outcome.reason,
    opts,
    outcome.res ?? null,
    outcome.reason === 'http-not-ok' ? opts?.notOkMessage : undefined,
  );
}

/** New timed signature plus the pre-Task-5 compatibility signature. */
export function upstreamFetchJson<T = unknown>(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  initOrOpts?: RequestInit | UpstreamFetchOpts,
  opts?: UpstreamFetchOpts,
): Promise<T>;
export function upstreamFetchJson<T = unknown>(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<T>;
export function upstreamFetchJson<T = unknown>(
  runtimeOrUrl: TelemetryRuntime | string,
  contextOrInit: UpstreamRouteContext | RequestInit | undefined,
  urlOrService: string,
  initOrOpts?: RequestInit | UpstreamFetchOpts,
  opts?: UpstreamFetchOpts,
): Promise<T> {
  if (isTelemetryRuntime(runtimeOrUrl)) {
    const args = splitHelperArgs(initOrOpts, opts);
    const context = contextOrInit as UpstreamRouteContext;
    return timedFetch(
      runtimeOrUrl,
      context,
      urlOrService,
      args.init,
      (res) =>
        consumeJson<T>(res, SERVICE_DISPLAY[context.service] ?? context.service, args.opts),
    );
  }
  return legacyFetchJson(
    runtimeOrUrl,
    contextOrInit as RequestInit | undefined,
    urlOrService,
    initOrOpts as UpstreamFetchOpts | undefined,
  );
}

async function legacyFetchJson<T>(
  url: string,
  init: RequestInit | undefined,
  service: string,
  opts?: UpstreamFetchOpts,
): Promise<T> {
  const outcome = await classifyUpstreamFetch(url, init);
  if (outcome.kind === 'gateway') throwStale(service, outcome.reason, opts, null);
  if (outcome.kind === 'stale') {
    throwStale(
      service,
      outcome.reason,
      opts,
      outcome.res ?? null,
      outcome.reason === 'http-not-ok' ? opts?.notOkMessage : undefined,
    );
  }
  const res = outcome.res;
  try {
    return (await res.json()) as T;
  } catch {
    const reason: UpstreamStaleReason = /text\/html/i.test(
      res.headers.get('content-type') ?? '',
    )
      ? 'html-content-type'
      : 'malformed-json';
    throwStale(service, reason, opts, res);
  }
}

/** Throw the uniform stale error after reporting only bounded evidence. */
function throwStale(
  service: string,
  reason: UpstreamStaleReason | 'fetch-threw',
  opts: UpstreamFetchOpts | undefined,
  res: Response | null,
  notOkMessage?: string,
): never {
  notifyStale(opts, reason);
  throw new StaleUpstreamError(service, reason, notOkMessage, res ?? undefined);
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
        input.onEvidence?.('redirect loop', undefined);
      } else if (outcome.reason === 'http-not-ok') {
        input.onEvidence?.(`http ${outcome.res?.status}`, undefined);
      } else if (outcome.reason === 'login-redirect') {
        input.onEvidence?.('login redirect', undefined);
      }
      return { valid: false, reason: 'stale' };
    }
    case 'ok': {
      const html = await outcome.res.text();
      if (!input.isAuthenticatedPage(outcome.res.url, html)) {
        input.onEvidence?.(
          input.missingMarkerEvidence ?? 'page missing sesskey (login redirect)',
          undefined,
        );
        return { valid: false, reason: 'stale' };
      }
      return { valid: true, reason: 'ok' };
    }
  }
}
