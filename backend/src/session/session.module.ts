import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SessionStore } from './session-store';
import { InMemorySessionStore } from './in-memory-session.store';
import { RedisSessionStore } from './redis-session.store';

/**
 * Build the session store from config. Fail-fast: Redis config problems and
 * connection failures throw at startup (never silently fall back to memory).
 */
export async function createSessionStore(config: ConfigService): Promise<SessionStore> {
  const ttlMs = Number(config.get('SESSION_TTL_MS'));
  if (config.get('SESSION_BACKEND') !== 'redis') {
    return new InMemorySessionStore(ttlMs);
  }
  const url = config.get<string>('REDIS_URL');
  const encKey = config.get<string>('SESSION_ENC_KEY');
  if (!url) throw new Error('SESSION_BACKEND=redis but REDIS_URL is not set');
  if (!encKey) throw new Error('SESSION_BACKEND=redis but SESSION_ENC_KEY is not set');
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Defer connecting until we explicitly connect() below. Without lazyConnect,
    // a command issued here (e.g. ping) races with the async socket connect and
    // throws "Stream isn't writeable" even when Redis is up.
    lazyConnect: true,
  });
  await client.connect(); // resolves once the socket is ready; rejects if Redis is down
  await client.ping(); // eager connection check — fail-fast if Redis is down
  return new RedisSessionStore(client, ttlMs, encKey);
}

@Module({
  providers: [
    {
      provide: SessionStore,
      inject: [ConfigService],
      useFactory: createSessionStore,
    },
  ],
  exports: [SessionStore],
})
export class SessionModule {}
