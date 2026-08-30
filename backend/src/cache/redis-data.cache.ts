import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { DataCache } from './data-cache';

const KEY_PREFIX = 'sso:cache:';

/** Storage envelope: value, fetchedAt (ms), expiresAt (ms). */
export interface RedisEnvelope<T> { v: T; fa: number; ex: number; }

@Injectable()
export class RedisDataCache extends DataCache implements OnModuleDestroy {
  private readonly logger = new Logger(RedisDataCache.name);
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
}
