import { HttpStatus, Logger, OnModuleDestroy } from '@nestjs/common';
import { StaleUpstreamError } from '../upstream/upstream-fetch';

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

function isTransientFailure(e: StaleUpstreamError): boolean {
  if (TRANSIENT_REASONS.has(e.reason)) return true;
  return e.reason === 'http-not-ok' && e.getStatus() === BAD_GATEWAY_STATUS;
}

function isDeadSession(e: StaleUpstreamError): boolean {
  if (DEAD_SESSION_REASONS.has(e.reason)) return true;
  // http-not-ok is 502 (transient) ONLY when the upstream status was >= 500 —
  // which `statusForStaleReason` already encoded as the error's HTTP status.
  // DO NOT read `e.getResponse()`: it returns the `{ message }` object passed
  // to `super()`, never the upstream `Response` (the 4th constructor arg is
  // consumed inside `statusForStaleReason` and not stored on the instance).
  // `e.getStatus()` is the reliable discriminator.
  if (e.reason === 'http-not-ok') {
    return e.getStatus() !== BAD_GATEWAY_STATUS; // 401 → dead session; 502 → transient
  }
  return false;
}

/**
 * Background-refresh failure policy (spec §3.3, option 2):
 * dead-session 401 → hard-expire (del) so the next request sync-fetches a
 * clean 401; transient → keep stale. Sync-path errors NEVER go through this.
 *
 * `onKeep` fires whenever the stale entry is kept (transient or unexpected
 * failure) so the caller can back off background refresh attempts — without
 * it, every stale read re-hits a failing upstream forever.
 */
export interface BackgroundErrorHooks {
  del(key: string): Promise<void>;
  /** Called after a keep-stale outcome (transient or unexpected error). */
  onKeep?: (key: string) => void;
}

export async function handleBackgroundError(
  cache: BackgroundErrorHooks,
  key: string,
  e: unknown,
): Promise<void> {
  const logger = new Logger('DataCache');
  if (e instanceof StaleUpstreamError) {
    if (isDeadSession(e)) {
      try {
        await cache.del(key);
        logger.warn(`[cache] swr hard-expire ${key} reason=${e.reason}`);
      } catch (deleteError) {
        logger.error(
          `[cache] swr hard-expire failed ${key}`,
          deleteError instanceof Error
            ? deleteError.stack
            : String(deleteError),
        );
      }
      return;
    }
    if (isTransientFailure(e)) {
      logger.debug(
        `[cache] swr refresh failed ${key} reason=${e.reason} (transient, keeping stale)`,
      );
      cache.onKeep?.(key);
      return;
    }
  }
  logger.warn(`[cache] swr refresh failed ${key}`, e);
  cache.onKeep?.(key);
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
