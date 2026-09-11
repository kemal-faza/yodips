import { HttpStatus } from '@nestjs/common';
import {
  UPSTREAM_HTTP_ERROR_REASONS,
  UPSTREAM_NETWORK_ERROR_REASONS,
  UPSTREAM_PARSE_ERROR_REASONS,
  UPSTREAM_STALE_REASONS,
  type UpstreamRequestEventInput,
  type UpstreamRoute,
} from '../observability/telemetry-contract';

/**
 * Telemetry event shaping + the transport-error side-channel.
 *
 * Shapes exactly one terminal `upstream.request` event per attempt, and stores
 * the private transport reason (fetch-threw / redirect-loop) on the thrown
 * error object via a WeakMap so callers can classify it without ever retaining
 * the transport message.
 */

export type TimedFetchTransportReason = 'fetch-threw' | 'redirect-loop';

const transportReasons = new WeakMap<object, TimedFetchTransportReason>();

/** Mark a thrown transport error with its bounded reason (never its message). */
export function rememberTransportReason(
  error: unknown,
  reason: TimedFetchTransportReason,
): void {
  if (typeof error === 'object' && error !== null)
    transportReasons.set(error, reason);
}

export function getTimedFetchTransportReason(
  error: unknown,
): TimedFetchTransportReason | undefined {
  return typeof error === 'object' && error !== null
    ? transportReasons.get(error)
    : undefined;
}

function hasReason<T extends readonly string[]>(
  reason: unknown,
  allowed: T,
): reason is T[number] {
  return (
    typeof reason === 'string' &&
    (allowed as readonly string[]).includes(reason)
  );
}

export function responseStatus(
  responseStatus: number,
  consumerStatus?: number,
): number {
  if (consumerStatus !== undefined && consumerStatus !== responseStatus) {
    throw new Error('Upstream response status mismatch');
  }
  return Number.isSafeInteger(responseStatus) &&
    responseStatus >= 100 &&
    responseStatus <= 599
    ? responseStatus
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

/** Minimal projection of an attempt result needed to shape the terminal event. */
type AttemptOutcomeProjection = {
  outcome: 'ok' | 'http_error' | 'parse_error' | 'stale';
  reason?: unknown;
};

export function terminalUpstreamEvent(
  context: UpstreamRoute,
  result: AttemptOutcomeProjection,
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
  return {
    ...base,
    outcome: 'stale',
    status,
    reason,
  } as UpstreamRequestEventInput;
}

export function parseUnknownEvent(
  context: UpstreamRoute,
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

export function networkEvent(
  context: UpstreamRoute,
  reason: TimedFetchTransportReason,
  durationMs: number,
): UpstreamRequestEventInput {
  return {
    event: 'upstream.request',
    service: context.service,
    operation: context.operation,
    route: context.route,
    outcome: 'network_error',
    reason: UPSTREAM_NETWORK_ERROR_REASONS.includes(reason)
      ? reason
      : 'fetch-threw',
    durationMs,
  } as UpstreamRequestEventInput;
}
