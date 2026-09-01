import { Injectable, Logger } from '@nestjs/common';
import {
  CACHE_BACKENDS,
  CACHE_LABELS,
  CACHE_REFRESH_REASONS,
  CACHE_REFRESH_OUTCOMES,
  CACHE_READ_OUTCOMES,
  CacheReadOutcome,
  TELEMETRY_EVENT_SHAPES,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_VALIDATION_RULES,
  TelemetryEventInput,
  UPSTREAM_HTTP_ERROR_REASONS,
  UPSTREAM_NETWORK_ERROR_REASONS,
  UPSTREAM_OUTCOMES,
  UPSTREAM_PARSE_ERROR_REASONS,
  UPSTREAM_ROUTES,
  UPSTREAM_REASONS,
  UPSTREAM_STALE_REASONS,
} from './telemetry-contract';
import type { UpstreamOutcome, UpstreamRoute } from './telemetry-contract';

type SafeSerializedEvent = Record<string, unknown>;
type LoggerLevel = 'debug' | 'warn' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= TELEMETRY_VALIDATION_RULES.numeric.minimum &&
    value <= TELEMETRY_VALIDATION_RULES.numeric.maximum
  );
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function hasForbiddenField(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => has(value, field));
}

function ttlFields(value: Record<string, unknown>): boolean {
  return isSafeInteger(value.freshTtlMs) && isSafeInteger(value.staleTtlMs);
}

function cacheReadEnvelope(
  value: Record<string, unknown>,
  ts: string,
  outcome: CacheReadOutcome,
): SafeSerializedEvent {
  return {
    v: TELEMETRY_SCHEMA_VERSION,
    ts,
    event: 'cache.read',
    cache: value.cache,
    backend: value.backend,
    outcome,
    durationMs: value.durationMs,
  };
}

function buildPlainCacheRead(
  value: Record<string, unknown>,
  ts: string,
  outcome: CacheReadOutcome,
  forbiddenFields: readonly string[] = TELEMETRY_EVENT_SHAPES['cache.read'].plain.forbidden,
): SafeSerializedEvent | undefined {
  if (hasForbiddenField(value, forbiddenFields)) return undefined;
  return cacheReadEnvelope(value, ts, outcome);
}

function buildStaleMissCacheRead(value: Record<string, unknown>, ts: string): SafeSerializedEvent | undefined {
  if (!ttlFields(value) || has(value, 'ageMs')) return undefined;
  return {
    ...cacheReadEnvelope(value, ts, 'miss'),
    freshTtlMs: value.freshTtlMs,
    staleTtlMs: value.staleTtlMs,
  };
}

function buildExistingCacheRead(
  value: Record<string, unknown>,
  ts: string,
  outcome: CacheReadOutcome,
): SafeSerializedEvent | undefined {
  if (!has(value, 'ageMs') || !ttlFields(value) || !isSafeInteger(value.ageMs)) return undefined;
  return {
    ...cacheReadEnvelope(value, ts, outcome),
    ageMs: value.ageMs,
    freshTtlMs: value.freshTtlMs,
    staleTtlMs: value.staleTtlMs,
  };
}

function buildCacheRead(value: Record<string, unknown>, ts: string): SafeSerializedEvent | undefined {
  if (
    !isOneOf(CACHE_LABELS, value.cache) ||
    !isOneOf(CACHE_BACKENDS, value.backend) ||
    !isOneOf(CACHE_READ_OUTCOMES, value.outcome) ||
    !isSafeInteger(value.durationMs)
  ) {
    return undefined;
  }

  const outcome = value.outcome as CacheReadOutcome;
  const authProbe = TELEMETRY_VALIDATION_RULES.cacheRead.authProbe;
  if (value.cache === authProbe.cache) {
    if (value.backend !== authProbe.backend || !isOneOf(authProbe.outcomes, outcome)) return undefined;
    return buildPlainCacheRead(value, ts, outcome, authProbe.forbidden);
  }
  if (outcome === 'hit') return buildPlainCacheRead(value, ts, outcome);
  if (outcome === 'miss') {
    return has(value, 'freshTtlMs')
      ? buildStaleMissCacheRead(value, ts)
      : buildPlainCacheRead(value, ts, outcome);
  }
  return buildExistingCacheRead(value, ts, outcome);
}

function buildCacheRefresh(value: Record<string, unknown>, ts: string): SafeSerializedEvent | undefined {
  if (
    !isOneOf(CACHE_LABELS, value.cache) ||
    !isOneOf(CACHE_BACKENDS, value.backend) ||
    !isOneOf(CACHE_REFRESH_OUTCOMES, value.outcome) ||
    !ttlFields(value)
  ) {
    return undefined;
  }
  if (value.cache === TELEMETRY_VALIDATION_RULES.cacheRead.authProbe.cache) return undefined;

  const outcome = value.outcome;
  const base = {
    v: TELEMETRY_SCHEMA_VERSION,
    ts,
    event: 'cache.refresh' as const,
    cache: value.cache,
    backend: value.backend,
    outcome,
    freshTtlMs: value.freshTtlMs,
    staleTtlMs: value.staleTtlMs,
  };

  if (outcome === 'started') {
    return has(value, 'durationMs') || has(value, 'reason') ? undefined : base;
  }
  if (!isSafeInteger(value.durationMs)) return undefined;
  if (outcome === 'ok') return has(value, 'reason') ? undefined : { ...base, durationMs: value.durationMs };
  if (!isOneOf(CACHE_REFRESH_REASONS, value.reason)) return undefined;
  if (
    outcome === 'hard_expire' &&
    value.reason !== TELEMETRY_VALIDATION_RULES.cacheRefresh.hardExpire.requiredReason
  ) {
    return undefined;
  }
  return { ...base, durationMs: value.durationMs, reason: value.reason };
}

type UpstreamResponseOutcome = Exclude<UpstreamOutcome, 'network_error'>;

function findUpstreamRoute(value: Record<string, unknown>): UpstreamRoute | undefined {
  return UPSTREAM_ROUTES.find(
    (candidate) =>
      candidate.service === value.service &&
      candidate.operation === value.operation &&
      candidate.route === value.route,
  );
}

function upstreamEnvelope(
  route: UpstreamRoute,
  outcome: UpstreamOutcome,
  ts: string,
): SafeSerializedEvent {
  return {
    v: TELEMETRY_SCHEMA_VERSION,
    ts,
    event: 'upstream.request',
    service: route.service,
    operation: route.operation,
    route: route.route,
    outcome,
  };
}

function isValidUpstreamStatus(value: unknown): value is number {
  return (
    isSafeInteger(value) &&
    value >= TELEMETRY_VALIDATION_RULES.upstreamStatus.minimum &&
    value <= TELEMETRY_VALIDATION_RULES.upstreamStatus.maximum
  );
}

function buildUpstreamNetworkError(
  value: Record<string, unknown>,
  base: SafeSerializedEvent,
): SafeSerializedEvent | undefined {
  if (
    !isOneOf(UPSTREAM_REASONS, value.reason) ||
    !isOneOf(UPSTREAM_NETWORK_ERROR_REASONS, value.reason) ||
    has(value, 'status')
  ) {
    return undefined;
  }
  return { ...base, durationMs: value.durationMs, reason: value.reason };
}

function buildUpstreamResponse(
  value: Record<string, unknown>,
  base: SafeSerializedEvent,
  outcome: UpstreamResponseOutcome,
): SafeSerializedEvent | undefined {
  if (!isValidUpstreamStatus(value.status)) return undefined;
  if (outcome === 'ok') {
    return has(value, 'reason') ? undefined : { ...base, status: value.status, durationMs: value.durationMs };
  }
  if (outcome === 'http_error') {
    return isOneOf(UPSTREAM_HTTP_ERROR_REASONS, value.reason)
      ? { ...base, status: value.status, durationMs: value.durationMs, reason: value.reason }
      : undefined;
  }
  if (outcome === 'parse_error') {
    return isOneOf(UPSTREAM_REASONS, value.reason) && isOneOf(UPSTREAM_PARSE_ERROR_REASONS, value.reason)
      ? { ...base, status: value.status, durationMs: value.durationMs, reason: value.reason }
      : undefined;
  }
  return isOneOf(UPSTREAM_REASONS, value.reason) && isOneOf(UPSTREAM_STALE_REASONS, value.reason)
    ? { ...base, status: value.status, durationMs: value.durationMs, reason: value.reason }
    : undefined;
}

function buildUpstream(value: Record<string, unknown>, ts: string): SafeSerializedEvent | undefined {
  const route = findUpstreamRoute(value);
  if (!route || value.event !== 'upstream.request' || !isSafeInteger(value.durationMs)) return undefined;
  if (!isOneOf(UPSTREAM_OUTCOMES, value.outcome)) return undefined;

  const outcome = value.outcome;
  const base = upstreamEnvelope(route, outcome, ts);
  return outcome === 'network_error'
    ? buildUpstreamNetworkError(value, base)
    : buildUpstreamResponse(value, base, outcome);
}

export function serializeTelemetryEvent(
  event: TelemetryEventInput,
  wallNowMs: number = Date.now(),
): SafeSerializedEvent | undefined {
  if (!Number.isFinite(wallNowMs)) return undefined;
  const date = new Date(wallNowMs);
  if (Number.isNaN(date.getTime())) return undefined;
  const ts = date.toISOString();
  if (!isRecord(event)) return undefined;
  if (event.event === 'cache.read') return buildCacheRead(event, ts);
  if (event.event === 'cache.refresh') return buildCacheRefresh(event, ts);
  if (event.event === 'upstream.request') return buildUpstream(event, ts);
  return undefined;
}

function levelFor(event: SafeSerializedEvent): LoggerLevel {
  if (event.event === 'cache.read') return event.outcome === 'stale' ? 'warn' : 'debug';
  if (event.event === 'cache.refresh') {
    if (event.outcome === 'hard_expire') return 'warn';
    if (event.outcome === 'error') {
      return event.reason === 'unexpected' || event.reason === 'unknown' ? 'error' : 'warn';
    }
    return 'debug';
  }
  if (event.outcome === 'ok') return 'debug';
  if (event.outcome === 'parse_error' && event.reason === 'unknown') return 'error';
  return 'warn';
}

@Injectable()
export class NestTelemetrySink {
  private readonly logger = new Logger(NestTelemetrySink.name);

  record(event: TelemetryEventInput): void {
    try {
      const serialized = serializeTelemetryEvent(event);
      if (!serialized) return;
      const line = JSON.stringify(serialized);
      if (typeof line !== 'string') return;
      switch (levelFor(serialized)) {
        case 'debug':
          this.logger.debug(line);
          return;
        case 'warn':
          this.logger.warn(line);
          return;
        case 'error':
          this.logger.error(line);
          return;
      }
    } catch {
      // Telemetry failures are deliberately silent and never recursively logged.
    }
  }
}
