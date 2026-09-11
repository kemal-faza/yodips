import { HttpStatus } from '@nestjs/common';
import {
  elapsedMs,
  recordTelemetry,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type { UpstreamReason } from '../observability/telemetry-contract';
import {
  classifyUpstreamResponse,
  isRedirectLoopCause,
  StaleUpstreamError,
  type UpstreamStaleReason,
} from './stale-classification';
import {
  validateUpstreamAttempt,
  type UpstreamRouteContext,
} from './route-inventory';
import {
  networkEvent,
  parseUnknownEvent,
  rememberTransportReason,
  responseStatus,
  terminalUpstreamEvent,
  type TimedFetchTransportReason,
} from './telemetry-events';

/**
 * One timed transport for authenticated upstream (SIAP/Kulon) session calls.
 *
 * `timedFetch` executes exactly one network attempt and records exactly one
 * terminal telemetry event, with response consumption part of the attempt so
 * parse/stale outcomes cannot be recorded separately from their transport.
 * No cookies/sesskeys are resolved here; adapters supply those.
 */

export type UpstreamAttemptResult<T> =
  | { ok: true; value: T; outcome: 'ok'; status?: number }
  | {
      ok: false;
      error?: unknown;
      outcome: 'http_error' | 'parse_error' | 'stale';
      reason?: UpstreamReason;
      status?: number;
    };

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
  const canonical = validateUpstreamAttempt(
    context,
    url,
    init?.method ?? 'GET',
  );
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
      terminalUpstreamEvent(
        canonical,
        result,
        status,
        safeDuration(runtime, started),
      ),
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

    const reason: TimedFetchTransportReason = isRedirectLoopCause(error)
      ? 'redirect-loop'
      : 'fetch-threw';
    rememberTransportReason(error, reason);
    recordTelemetry(
      runtime,
      networkEvent(canonical, reason, safeDuration(runtime, started)),
    );
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
  return {
    ok: true,
    value: await res.text(),
    outcome: 'ok',
    status: res.status,
  };
}

async function consumeJson<T>(
  res: Response,
  service: string,
  opts: UpstreamFetchOpts | undefined,
): Promise<UpstreamAttemptResult<T>> {
  const failure = responseFailure(service, res, opts);
  if (failure) return failure;
  try {
    return {
      ok: true,
      value: (await res.json()) as T,
      outcome: 'ok',
      status: res.status,
    };
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

/** Authenticated upstream text fetch under one timed signature. */
export function upstreamFetchText(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  init?: RequestInit,
  opts?: UpstreamFetchOpts,
): Promise<string> {
  return timedFetch(runtime, context, url, init, (res) =>
    consumeText(res, context.service, opts),
  );
}

/** Authenticated upstream JSON fetch under one timed signature. */
export function upstreamFetchJson<T = unknown>(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  init?: RequestInit,
  opts?: UpstreamFetchOpts,
): Promise<T> {
  return timedFetch(runtime, context, url, init, (res) =>
    consumeJson<T>(res, context.service, opts),
  );
}
