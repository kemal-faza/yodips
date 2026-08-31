import { Logger } from '@nestjs/common';
import { createKeyedSingleFlight } from '../common/single-flight';
import {
  DataCache,
  defaultStaleTtlMs,
  handleBackgroundError,
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
    const e = this.entries.get(key);
    if (e && Date.now() <= e.expiresAt) {
      const age = Date.now() - e.fetchedAt;
      if (age < opts.freshTtlMs)
        return { value: JSON.parse(e.value) as T, stale: false };
      if (age < staleCutoff) {
        this.logger.debug(
          `[cache] swr stale serve ${key} age=${age}ms fresh=${opts.freshTtlMs} stale=${staleTtl}`,
        );
        // stale: serve now, refresh in background (single-flight per key)
        void this.swrFlight.run(key, async () => {
          try {
            const fresh = await fetcher();
            await this.set(key, fresh, opts.freshTtlMs);
            this.logger.debug(`[cache] swr refresh ok ${key}`);
          } catch (err) {
            await handleBackgroundError({ del: (k) => this.del(k) }, key, err);
          }
        });
        return { value: JSON.parse(e.value) as T, stale: true };
      }
    }
    const fresh = await fetcher();
    await this.set(key, fresh, staleCutoff);
    return { value: fresh, stale: false };
  }
}
