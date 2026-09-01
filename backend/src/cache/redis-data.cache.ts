import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createKeyedSingleFlight, type OwnedFlight } from '../common/single-flight';
import {
  classifyBackgroundError,
  DataCache,
  defaultStaleTtlMs,
  handleBackgroundError,
  markCacheStorageFailure,
  REFRESH_BACKOFF_MS,
  SwrOptions,
  SwrResult,
  type BackgroundRefreshDecision,
} from './data-cache';
import { classifyCacheKey } from './cache-policy';
import {
  createNoopTelemetryRuntime,
  elapsedMs,
  recordTelemetry,
  safeAgeMs,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type {
  CacheReadEventInput,
  CacheRefreshEventInput,
} from '../observability/telemetry-contract';

const KEY_PREFIX = 'sso:cache:';

/** Storage envelope: value, fetchedAt (ms), expiresAt (ms). */
export interface RedisEnvelope<T> {
  v: T;
  fa: number;
  ex: number;
}

function parseEnvelope<T>(raw: string): RedisEnvelope<T> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const env = parsed as Partial<RedisEnvelope<T>>;
    if (!Object.prototype.hasOwnProperty.call(env, 'v')) return undefined;
    const fetchedAt = env.fa;
    const expiresAt = env.ex;
    if (
      typeof fetchedAt !== 'number' ||
      typeof expiresAt !== 'number' ||
      !Number.isFinite(fetchedAt) ||
      !Number.isFinite(expiresAt)
    ) {
      return undefined;
    }
    if (expiresAt <= fetchedAt) return undefined;
    return { v: env.v as T, fa: fetchedAt, ex: expiresAt };
  } catch {
    return undefined;
  }
}

@Injectable()
export class RedisDataCache extends DataCache implements OnModuleDestroy {
  private readonly swrFlight = createKeyedSingleFlight<unknown>();
  /** Per-key timestamp until which background refresh attempts are suppressed. */
  private readonly refreshHold = new Map<string, number>();

  constructor(
    private readonly client: Redis,
    private readonly defaultTtlMs: number,
    private readonly runtime: TelemetryRuntime = createNoopTelemetryRuntime(),
  ) {
    super();
  }

  async get<T>(key: string): Promise<T | null> {
    const started = this.monotonicNowNs();
    let raw: string | null;
    try {
      raw = await this.client.get(`${KEY_PREFIX}${key}`);
    } catch (error) {
      markCacheStorageFailure(error);
      this.emitPlainRead(key, 'miss', started);
      throw error;
    }
    if (raw == null) {
      this.emitPlainRead(key, 'miss', started);
      return null;
    }

    const env = parseEnvelope<T>(raw);
    if (!env) {
      try {
        await this.deleteMalformed(key);
      } catch (error) {
        this.emitPlainRead(key, 'miss', started);
        throw error;
      }
      this.emitPlainRead(key, 'miss', started);
      return null;
    }
    this.emitPlainRead(key, 'hit', started);
    return env.v;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      const ttl = ttlMs ?? this.defaultTtlMs;
      const now = this.wallNowMs();
      const ttlSec = Math.floor(ttl / 1000);
      const env: RedisEnvelope<T> = { v: value, fa: now, ex: now + ttl };
      await this.client.set(
        `${KEY_PREFIX}${key}`,
        JSON.stringify(env),
        'EX',
        Math.max(1, ttlSec),
      );
    } catch (error) {
      markCacheStorageFailure(error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(`${KEY_PREFIX}${key}`);
    } catch (error) {
      markCacheStorageFailure(error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async getStale<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts: SwrOptions,
  ): Promise<SwrResult<T>> {
    const staleTtl = opts.staleTtlMs ?? defaultStaleTtlMs(opts.freshTtlMs);
    const staleCutoff = opts.freshTtlMs + staleTtl;
    const readStarted = this.monotonicNowNs();
    let raw: string | null;
    try {
      raw = await this.client.get(`${KEY_PREFIX}${key}`);
    } catch (error) {
      markCacheStorageFailure(error);
      this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
      throw error;
    }

    const now = this.wallNowMs();
    if (raw != null) {
      const env = parseEnvelope<T>(raw);
      if (env) {
        const age = safeAgeMs(now, env.fa);
        if (age < opts.freshTtlMs) {
          this.emitExistingRead(key, 'fresh', age, opts, staleTtl, readStarted);
          return { value: env.v, stale: false };
        }
        if (age < staleCutoff) {
          this.emitExistingRead(key, 'stale', age, opts, staleTtl, readStarted);
          if (now >= (this.refreshHold.get(key) ?? 0)) {
            const owned = this.startRefresh(key, fetcher, staleCutoff, opts, true);
            void owned.promise.catch(() => undefined);
          }
          return { value: env.v, stale: true };
        }
        this.emitExistingRead(key, 'expired', age, opts, staleTtl, readStarted);
      } else {
        try {
          await this.deleteMalformed(key);
        } catch (error) {
          this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
          throw error;
        }
        this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
      }
    } else {
      this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
    }

    const owned = this.startRefresh(key, fetcher, staleCutoff, opts, false);
    return { value: (await owned.promise) as T, stale: false };
  }

  private async deleteMalformed(key: string): Promise<void> {
    try {
      await this.client.del(`${KEY_PREFIX}${key}`);
    } catch (error) {
      markCacheStorageFailure(error);
      throw error;
    }
  }

  private backoffRefresh(key: string): void {
    const until = this.wallNowMs() + REFRESH_BACKOFF_MS;
    const existing = this.refreshHold.get(key) ?? 0;
    this.refreshHold.set(key, Math.max(existing, until));
  }

  private startRefresh<T>(
    key: string,
    fetcher: () => Promise<T>,
    staleCutoff: number,
    opts: SwrOptions,
    background: boolean,
  ): OwnedFlight<T> {
    let started = 0n;
    const owned = this.swrFlight.runOwned(
      key,
      () => this.executeRefresh(key, fetcher, staleCutoff, opts, background, started),
      () => {
        started = this.monotonicNowNs();
        this.emitRefresh(key, opts, 'started');
      },
    );
    return owned as OwnedFlight<T>;
  }

  private async executeRefresh<T>(
    key: string,
    fetcher: () => Promise<T>,
    staleCutoff: number,
    opts: SwrOptions,
    background: boolean,
    started: bigint,
  ): Promise<T> {
    try {
      const fresh = await fetcher();
      await this.set(key, fresh, staleCutoff);
      this.refreshHold.delete(key);
      this.emitRefresh(key, opts, 'ok', this.durationMs(started));
      return fresh;
    } catch (error) {
      const reason = classifyBackgroundError(error);
      let decision: BackgroundRefreshDecision = {
        outcome: 'error',
        reason,
        keepStale: true,
      };
      if (background) {
        decision = await handleBackgroundError(
          { del: (cacheKey) => this.del(cacheKey) },
          key,
          error,
        );
        if (decision.keepStale) this.backoffRefresh(key);
      }
      this.emitRefresh(
        key,
        opts,
        decision.outcome === 'hard_expire' ? 'hard_expire' : 'error',
        this.durationMs(started),
        decision.reason,
      );
      throw error;
    }
  }

  private emitPlainRead(key: string, outcome: 'hit' | 'miss', started: bigint): void {
    const event: CacheReadEventInput = {
      event: 'cache.read',
      cache: classifyCacheKey(key).label,
      backend: 'redis',
      outcome,
      durationMs: this.durationMs(started),
    };
    recordTelemetry(this.runtime, event);
  }

  private emitSwrRead(
    key: string,
    outcome: 'miss',
    staleTtlMs: number,
    freshTtlMs: number,
    started: bigint,
  ): void {
    const event: CacheReadEventInput = {
      event: 'cache.read',
      cache: classifyCacheKey(key).label,
      backend: 'redis',
      outcome,
      freshTtlMs,
      staleTtlMs,
      durationMs: this.durationMs(started),
    };
    recordTelemetry(this.runtime, event);
  }

  private emitExistingRead(
    key: string,
    outcome: 'fresh' | 'stale' | 'expired',
    ageMs: number,
    opts: SwrOptions,
    staleTtlMs: number,
    started: bigint,
  ): void {
    const event: CacheReadEventInput = {
      event: 'cache.read',
      cache: classifyCacheKey(key).label,
      backend: 'redis',
      outcome,
      ageMs,
      freshTtlMs: opts.freshTtlMs,
      staleTtlMs,
      durationMs: this.durationMs(started),
    };
    recordTelemetry(this.runtime, event);
  }

  private emitRefresh(
    key: string,
    opts: SwrOptions,
    outcome: 'started' | 'ok' | 'error' | 'hard_expire',
    durationMs?: number,
    reason?: BackgroundRefreshDecision['reason'],
  ): void {
    const event = {
      event: 'cache.refresh',
      cache: classifyCacheKey(key).label,
      backend: 'redis',
      freshTtlMs: opts.freshTtlMs,
      staleTtlMs: opts.staleTtlMs ?? defaultStaleTtlMs(opts.freshTtlMs),
      outcome,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(reason === undefined ? {} : { reason }),
    } as CacheRefreshEventInput;
    recordTelemetry(this.runtime, event);
  }

  private wallNowMs(): number {
    try {
      const now = this.runtime.wallNowMs();
      return Number.isFinite(now) ? Math.floor(now) : 0;
    } catch {
      return 0;
    }
  }

  private monotonicNowNs(): bigint {
    try {
      const now = this.runtime.monotonicNowNs();
      return typeof now === 'bigint' ? now : 0n;
    } catch {
      return 0n;
    }
  }

  private durationMs(started: bigint): number {
    try {
      return elapsedMs(started, this.monotonicNowNs());
    } catch {
      return 0;
    }
  }
}
