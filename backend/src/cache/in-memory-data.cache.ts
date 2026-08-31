import { Logger } from '@nestjs/common';
import { createKeyedSingleFlight } from '../common/single-flight';
import {
  DataCache,
  defaultStaleTtlMs,
  handleBackgroundError,
  REFRESH_BACKOFF_MS,
  SwrOptions,
  SwrResult,
} from './data-cache';

interface Entry {
  value: string;
  expiresAt: number;
  fetchedAt: number;
}

/** Dev/test cache: TTL + expiry, mirrors InMemorySessionStore. */
export class InMemoryDataCache extends DataCache {
  private readonly logger = new Logger(InMemoryDataCache.name);
  private readonly entries = new Map<string, Entry>();
  private readonly swrFlight = createKeyedSingleFlight<unknown>();
  /** Per-key timestamp until which background refresh attempts are suppressed
   *  (set on refresh failure, cleared on success). Breaks the unbounded
   *  refresh loop against a failing upstream — see REFRESH_BACKOFF_MS. */
  private readonly refreshHold = new Map<string, number>();
  constructor(private readonly defaultTtlMs: number) {
    super();
  }

  get<T>(key: string): Promise<T | null> {
    const e = this.entries.get(key);
    if (!e) return Promise.resolve(null);
    if (Date.now() > e.expiresAt) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    e.expiresAt = Date.now() + this.defaultTtlMs; // sliding
    try {
      return Promise.resolve(JSON.parse(e.value) as T);
    } catch {
      return Promise.resolve(null);
    }
  }

  set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttl,
      fetchedAt: Date.now(),
    });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
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
    const refresh = () =>
      this.swrFlight.run(key, async () => {
        const fresh = await fetcher();
        await this.set(key, fresh, staleCutoff);
        this.refreshHold.delete(key);
        this.logger.debug(`[cache] swr refresh ok ${key}`);
        return fresh;
      });
    const e = this.entries.get(key);
    if (e && Date.now() <= e.expiresAt) {
      try {
        const value = JSON.parse(e.value) as T;
        const age = Date.now() - e.fetchedAt;
        if (age < opts.freshTtlMs) return { value, stale: false };
        if (age < staleCutoff) {
          this.logger.debug(
            `[cache] swr stale serve ${key} age=${age}ms fresh=${opts.freshTtlMs} stale=${staleTtl}`,
          );
          // stale: serve now, refresh in background (single-flight per key,
          // gated by the failure backoff so a failing upstream is not re-hit
          // on every stale read).
          if (Date.now() >= (this.refreshHold.get(key) ?? 0)) {
            void refresh().catch(async (err) => {
              try {
                await handleBackgroundError(
                  {
                    del: (k) => this.del(k),
                    onKeep: () => this.backoffRefresh(key),
                  },
                  key,
                  err,
                );
              } catch (handlerError) {
                this.logger.error(
                  `[cache] swr error handling failed ${key}`,
                  handlerError instanceof Error
                    ? handlerError.stack
                    : String(handlerError),
                );
              }
            });
          }
          return { value, stale: true };
        }
      } catch {
        this.entries.delete(key);
      }
    }
    // Expired/malformed entries share any refresh already started by a stale
    // caller, preventing a late background write from overwriting this result.
    const fresh = (await refresh()) as T;
    return { value: fresh, stale: false };
  }

  private backoffRefresh(key: string): void {
    const until = Date.now() + REFRESH_BACKOFF_MS;
    const existing = this.refreshHold.get(key) ?? 0;
    this.refreshHold.set(key, Math.max(existing, until));
  }
}
