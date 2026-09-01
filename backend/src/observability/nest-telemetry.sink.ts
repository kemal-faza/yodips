import { Injectable, Logger } from '@nestjs/common';
import {
  CACHE_BACKENDS,
  CACHE_LABELS,
  CACHE_REFRESH_REASONS,
  CACHE_REFRESH_OUTCOMES,
  CACHE_READ_OUTCOMES,
  CacheRefreshReason,
  CacheReadOutcome,
  TELEMETRY_SCHEMA_VERSION,
  TelemetryEventInput,
  UPSTREAM_OUTCOMES,
  UPSTREAM_ROUTES,
  UPSTREAM_REASONS,
} from './telemetry-contract';

type SafeSerializedEvent = Record<string, unknown>;
type LoggerLevel = 'debug' | 'warn' | 'error';

const PARSE_REASONS = new Set(['html-content-type', 'malformed-json', 'non-json-process', 'unknown']);
const NETWORK_REASONS = new Set(['fetch-threw', 'redirect-loop']);
const STALE_REASONS = new Set([
  'login-redirect',
  'no-cookie',
  'api-credential',
  'api-endpoint',
  'no-api-upstream',
  'no-emailSso',
  'stale',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function hasOnlyPlainReadShape(value: Record<string, unknown>): boolean {
  return !has(value, 'ageMs') && !has(value, 'freshTtlMs') && !has(value, 'staleTtlMs');
}

function ttlFields(value: Record<string, unknown>): boolean {
  return isSafeInteger(value.freshTtlMs) && isSafeInteger(value.staleTtlMs);
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
  const isProbe = value.cache === 'auth.probe';
  if (isProbe && value.backend !== 'memory') return undefined;
  const plain = isProbe;
  if (plain && outcome !== 'hit' && outcome !== 'miss') return undefined;

  if (outcome === 'hit') {
    if (!hasOnlyPlainReadShape(value)) return undefined;
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

  if (outcome === 'miss' && has(value, 'freshTtlMs')) {
    if (plain || !ttlFields(value) || has(value, 'ageMs')) return undefined;
    return {
      v: TELEMETRY_SCHEMA_VERSION,
      ts,
      event: 'cache.read',
      cache: value.cache,
      backend: value.backend,
      outcome,
      freshTtlMs: value.freshTtlMs,
      staleTtlMs: value.staleTtlMs,
      durationMs: value.durationMs,
    };
  }

  if (outcome === 'miss') {
    if (!hasOnlyPlainReadShape(value)) return undefined;
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

  if (
    !has(value, 'ageMs') ||
    !ttlFields(value) ||
    !isSafeInteger(value.ageMs)
  ) {
    return undefined;
  }
  return {
    v: TELEMETRY_SCHEMA_VERSION,
    ts,
    event: 'cache.read',
    cache: value.cache,
    backend: value.backend,
    outcome,
    ageMs: value.ageMs,
    freshTtlMs: value.freshTtlMs,
    staleTtlMs: value.staleTtlMs,
    durationMs: value.durationMs,
  };
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
  if (value.cache === 'auth.probe') return undefined;

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
  if (outcome === 'hard_expire' && value.reason !== 'dead-session') return undefined;
  return { ...base, durationMs: value.durationMs, reason: value.reason as CacheRefreshReason };
}

function buildUpstream(value: Record<string, unknown>, ts: string): SafeSerializedEvent | undefined {
  const route = UPSTREAM_ROUTES.find(
    (candidate) =>
      candidate.service === value.service &&
      candidate.operation === value.operation &&
      candidate.route === value.route,
  );
  if (!route || value.event !== 'upstream.request' || !isSafeInteger(value.durationMs)) return undefined;

  if (!isOneOf(UPSTREAM_OUTCOMES, value.outcome)) return undefined;
  const outcome = value.outcome;
  const base = {
    v: TELEMETRY_SCHEMA_VERSION,
    ts,
    event: 'upstream.request' as const,
    service: route.service,
    operation: route.operation,
    route: route.route,
    outcome,
  };

  if (outcome === 'network_error') {
    if (!isOneOf(UPSTREAM_REASONS, value.reason) || !NETWORK_REASONS.has(value.reason) || has(value, 'status')) {
      return undefined;
    }
    return { ...base, durationMs: value.durationMs, reason: value.reason };
  }

  if (!isSafeInteger(value.status) || value.status < 100 || value.status > 599) return undefined;
  if (outcome === 'ok') return has(value, 'reason') ? undefined : { ...base, status: value.status, durationMs: value.durationMs };
  if (outcome === 'http_error') {
    return value.reason === 'http-not-ok'
      ? { ...base, status: value.status, durationMs: value.durationMs, reason: 'http-not-ok' }
      : undefined;
  }
  if (outcome === 'parse_error') {
    return isOneOf(UPSTREAM_REASONS, value.reason) && PARSE_REASONS.has(value.reason)
      ? { ...base, status: value.status, durationMs: value.durationMs, reason: value.reason }
      : undefined;
  }
  if (outcome === 'stale') {
    return isOneOf(UPSTREAM_REASONS, value.reason) && STALE_REASONS.has(value.reason)
      ? { ...base, status: value.status, durationMs: value.durationMs, reason: value.reason }
      : undefined;
  }
  return undefined;
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
