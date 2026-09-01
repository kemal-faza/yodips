import { HttpStatus, OnModuleDestroy } from '@nestjs/common';
import {
  getTimedFetchTransportReason,
  StaleUpstreamError,
} from '../upstream/upstream-fetch';
import type { CacheRefreshReason } from '../observability/telemetry-contract';

export interface SwrOptions {
  freshTtlMs: number;
  /** Defaults to defaultStaleTtlMs(freshTtlMs). */
  staleTtlMs?: number;
}

export interface SwrResult<T> {
  value: T;
  stale: boolean;
}

/** No stale window exceeds 30 min; short TTLs double. */
export function defaultStaleTtlMs(freshTtlMs: number): number {
  return freshTtlMs >= 900_000
    ? Math.min(freshTtlMs * 2, 30 * 60_000)
    : freshTtlMs * 2;
}

/** 401 bucket: genuine dead-session evidence (statusForStaleReason → 401). */
const DEAD_SESSION_REASONS = new Set([
  'login-redirect',
  'no-cookie',
  'api-credential',
  'redirect-loop',
  'html-content-type',
  'malformed-json',
  'no-emailSso',
  'non-json-process',
]);

/** Transient upstream trouble (statusForStaleReason → 502). */
const TRANSIENT_REASONS = new Set([
  'fetch-threw',
  'api-endpoint',
  'no-api-upstream',
]);
const BAD_GATEWAY_STATUS: number = HttpStatus.BAD_GATEWAY;

/** Storage failures are branded without mutating or replacing the thrown value. */
const storageFailures = new WeakMap<object, true>();

export function markCacheStorageFailure(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    storageFailures.set(error, true);
  }
}

function isCacheStorageFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && storageFailures.has(error);
}

function isKulonCompatibilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(?:Kulon page (?:failed|not found)|(?:ASSIGNMENT|COURSE)_NOT_FOUND$|sesskey not found in Kulon page)/i.test(
    error.message,
  );
}

/**
 * Background-refresh failure policy (spec §3.3, option 2):
 * dead-session 401 → hard-expire (del) so the next request sync-fetches a
 * clean 401; transient → keep stale. Sync-path errors NEVER go through this.
 *
 * Cache implementations apply their own backoff after receiving a keep-stale
 * decision; this helper deliberately has no telemetry or logging side effects.
 */
export interface BackgroundErrorHooks {
  del(key: string): Promise<void>;
  /** Retained for source compatibility; policy decisions do not invoke hooks. */
  onKeep?: (key: string) => void;
}

export type BackgroundRefreshDecision =
  | { outcome: 'hard_expire'; reason: 'dead-session'; keepStale: false }
  | { outcome: 'error'; reason: CacheRefreshReason; keepStale: true };

export function classifyBackgroundError(error: unknown): CacheRefreshReason {
  // A timed transport marker is stronger evidence than the stale error that
  // may be wrapped around or raised after the transport attempt.
  const transportReason = getTimedFetchTransportReason(error);
  if (transportReason === 'fetch-threw') return 'transient';
  if (transportReason === 'redirect-loop') return 'dead-session';

  if (error instanceof StaleUpstreamError) {
    if (error.reason === 'stale') return 'unexpected';
    if (DEAD_SESSION_REASONS.has(error.reason)) return 'dead-session';
    if (TRANSIENT_REASONS.has(error.reason)) return 'transient';
    if (error.reason === 'http-not-ok') {
      return error.getStatus() === BAD_GATEWAY_STATUS ? 'transient' : 'dead-session';
    }
    return 'unknown';
  }

  if (isCacheStorageFailure(error) || isKulonCompatibilityError(error)) {
    return 'unexpected';
  }
  return 'unknown';
}

export async function handleBackgroundError(
  cache: BackgroundErrorHooks,
  key: string,
  e: unknown,
): Promise<BackgroundRefreshDecision> {
  const reason = classifyBackgroundError(e);
  if (reason !== 'dead-session') {
    return { outcome: 'error', reason, keepStale: true };
  }

  try {
    await cache.del(key);
    return { outcome: 'hard_expire', reason: 'dead-session', keepStale: false };
  } catch {
    return { outcome: 'error', reason: 'unexpected', keepStale: true };
  }
}

/** How long a failed refresh blocks new background attempts for the same key.
 *  Fixed 60s: bounded, simple, and far longer than any poll interval. */
export const REFRESH_BACKOFF_MS = 60_000;

export abstract class DataCache implements OnModuleDestroy {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  /** SWR read: fresh → cached; stale → cached + background refresh; expired/miss → sync fetch. */
  abstract getStale<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts: SwrOptions,
  ): Promise<SwrResult<T>>;
  abstract onModuleDestroy(): Promise<void>;
}
