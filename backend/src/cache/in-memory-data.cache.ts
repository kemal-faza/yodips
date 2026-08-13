import { Logger } from '@nestjs/common';
import { DataCache } from './data-cache';

interface Entry { value: string; expiresAt: number; }

/** Dev/test cache: TTL + expiry, mirrors InMemorySessionStore. */
export class InMemoryDataCache extends DataCache {
  private readonly logger = new Logger(InMemoryDataCache.name);
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly defaultTtlMs: number) { super(); }

  async get<T>(key: string): Promise<T | null> {
    const e = this.entries.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { this.entries.delete(key); return null; }
    e.expiresAt = Date.now() + this.defaultTtlMs; // sliding
    try { return JSON.parse(e.value) as T; } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.entries.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttl });
  }

  async del(key: string): Promise<void> { this.entries.delete(key); }

  async onModuleDestroy(): Promise<void> { this.entries.clear(); }
}