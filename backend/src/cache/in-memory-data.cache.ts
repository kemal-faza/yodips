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
import type { CacheReadEventInput, CacheRefreshEventInput } from '../observability/telemetry-contract';

interface Entry {
  value: string;
  expiresAt: number;
  fetchedAt: number;
}

/** Dev/test cache: TTL + expiry, mirrors InMemorySessionStore. */
export class InMemoryDataCache extends DataCache {
  private readonly entries = new Map<string, Entry>();
  private readonly swrFlight = createKeyedSingleFlight<unknown>();
  /** Per-key timestamp until which background refresh attempts are suppressed
   *  (set on refresh failure, cleared on success). Breaks the unbounded
   *  refresh loop against a failing upstream — see REFRESH_BACKOFF_MS. */
  private readonly refreshHold = new Map<string, number>();
  constructor(
    private readonly defaultTtlMs: number,
    private readonly runtime: TelemetryRuntime = createNoopTelemetryRuntime(),
  ) {
    super();
  }

  async get<T>(key: string): Promise<T | null> {
    const started = this.monotonicNowNs();
    try {
      const e = this.entries.get(key);
      if (!e) {
        this.emitPlainRead(key, 'miss', started);
        return null;
      }
      const now = this.wallNowMs();
      if (now > e.expiresAt) {
        this.entries.delete(key);
        this.emitPlainRead(key, 'miss', started);
        return null;
      }
      e.expiresAt = now + this.defaultTtlMs; // sliding
      let value: T;
      try {
        value = JSON.parse(e.value) as T;
      } catch {
        this.emitPlainRead(key, 'miss', started);
        return null;
      }
      this.emitPlainRead(key, 'hit', started);
      return value;
    } catch (error) {
      markCacheStorageFailure(error);
      this.emitPlainRead(key, 'miss', started);
      throw error;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      const ttl = ttlMs ?? this.defaultTtlMs;
      const now = this.wallNowMs();
      this.entries.set(key, {
        value: JSON.stringify(value),
        expiresAt: now + ttl,
        fetchedAt: now,
      });
    } catch (error) {
      markCacheStorageFailure(error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      this.entries.delete(key);
    } catch (error) {
      markCacheStorageFailure(error);
      throw error;
    }
  }

  onModuleDestroy(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  async getStale<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts: SwrOptions,
  ): Promise<SwrResult<T>> {
    const staleTtl = opts.staleTtlMs ?? defaultStaleTtlMs(opts.freshTtlMs);
    const staleCutoff = opts.freshTtlMs + staleTtl;
    const readStarted = this.monotonicNowNs();
    let e: Entry | undefined;
    try {
      e = this.entries.get(key);
    } catch (error) {
      markCacheStorageFailure(error);
      this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
      throw error;
    }

    const now = this.wallNowMs();
    if (e) {
      try {
        const value = JSON.parse(e.value) as T;
        const age = safeAgeMs(now, e.fetchedAt);
        if (age < opts.freshTtlMs) {
          this.emitExistingRead(key, 'fresh', age, opts, staleTtl, readStarted);
          return { value, stale: false };
        }
        if (age < staleCutoff) {
          this.emitExistingRead(key, 'stale', age, opts, staleTtl, readStarted);
          if (now >= (this.refreshHold.get(key) ?? 0)) {
            const owned = this.startRefresh(key, fetcher, staleCutoff, opts, true);
            void owned.promise.catch(() => undefined);
          }
          return { value, stale: true };
        }
        this.emitExistingRead(key, 'expired', age, opts, staleTtl, readStarted);
      } catch (error) {
        try {
          this.entries.delete(key);
        } catch (deleteError) {
          markCacheStorageFailure(deleteError);
          this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
          throw deleteError;
        }
        this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
      }
    } else {
      this.emitSwrRead(key, 'miss', staleTtl, opts.freshTtlMs, readStarted);
    }

    const owned = this.startRefresh(key, fetcher, staleCutoff, opts, false);
    return { value: (await owned.promise) as T, stale: false };
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

  private emitPlainRead(
    key: string,
    outcome: 'hit' | 'miss',
    started: bigint,
  ): void {
    const event: CacheReadEventInput = {
      event: 'cache.read',
      cache: classifyCacheKey(key).label,
      backend: 'memory',
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
      backend: 'memory',
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
      backend: 'memory',
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
      backend: 'memory',
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
