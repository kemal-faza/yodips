import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { DataCache } from './data-cache';

const KEY_PREFIX = 'sso:cache:';

@Injectable()
export class RedisDataCache extends DataCache implements OnModuleDestroy {
  private readonly logger = new Logger(RedisDataCache.name);
  constructor(private readonly client: Redis, private readonly defaultTtlMs: number) { super(); }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(`${KEY_PREFIX}${key}`);
    if (raw == null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttlSec = Math.floor((ttlMs ?? this.defaultTtlMs) / 1000);
    await this.client.set(`${KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', Math.max(1, ttlSec));
  }

  async del(key: string): Promise<void> { await this.client.del(`${KEY_PREFIX}${key}`); }

  async onModuleDestroy(): Promise<void> { await this.client.quit(); }
}