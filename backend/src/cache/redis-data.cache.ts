import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createKeyedSingleFlight } from '../common/single-flight';
import { DataCache, defaultStaleTtlMs, handleBackgroundError, SwrOptions, SwrResult } from './data-cache';

const KEY_PREFIX = 'sso:cache:';

/** Storage envelope: value, fetchedAt (ms), expiresAt (ms). */
export interface RedisEnvelope<T> { v: T; fa: number; ex: number; }

@Injectable()
export class RedisDataCache extends DataCache implements OnModuleDestroy {
  private readonly logger = new Logger(RedisDataCache.name);
  private readonly swrFlight = createKeyedSingleFlight<unknown>();
  constructor(private readonly client: Redis, private readonly defaultTtlMs: number) { super(); }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(`${KEY_PREFIX}${key}`);
    if (raw == null) return null;
    try {
      const env = JSON.parse(raw) as RedisEnvelope<T>;
      if (typeof env?.fa !== 'number' || typeof env?.ex !== 'number') return null; // legacy bare JSON
      return env.v;
    } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    const ttlSec = Math.floor(ttl / 1000);
    const env: RedisEnvelope<T> = { v: value, fa: now, ex: now + ttl };
    await this.client.set(`${KEY_PREFIX}${key}`, JSON.stringify(env), 'EX', Math.max(1, ttlSec));
  }

  async del(key: string): Promise<void> { await this.client.del(`${KEY_PREFIX}${key}`); }

  async onModuleDestroy(): Promise<void> { await this.client.quit(); }

  async getStale<T>(key: string, fetcher: () => Promise<T>, opts: SwrOptions): Promise<SwrResult<T>> {
    const staleTtl = opts.staleTtlMs ?? defaultStaleTtlMs(opts.freshTtlMs);
    const raw = await this.client.get(`${KEY_PREFIX}${key}`);
    if (raw != null) {
      try {
        const env = JSON.parse(raw) as { v: T; fa: number; ex: number };
        if (typeof env.fa === 'number' && typeof env.ex === 'number') {
          const age = Date.now() - env.fa;
          if (age < opts.freshTtlMs) return { value: env.v, stale: false };
          if (age < staleTtl) {
            this.logger.debug(
              `[cache] swr stale serve ${key} age=${age}ms fresh=${opts.freshTtlMs} stale=${staleTtl}`,
            );
            void this.swrFlight.run(key, async () => {
              try {
                const fresh = await fetcher();
                await this.set(key, fresh, opts.freshTtlMs);
                this.logger.debug(`[cache] swr refresh ok ${key}`);
              } catch (err) {
                await handleBackgroundError({ del: (k) => this.del(k) }, key, err);
              }
            });
            return { value: env.v, stale: true };
          }
        }
      } catch { /* legacy/parse-fail → fall through to sync fetch */ }
    }
    const fresh = await fetcher();
    await this.set(key, fresh, opts.freshTtlMs);
    return { value: fresh, stale: false };
  }
}
