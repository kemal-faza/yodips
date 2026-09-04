import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionStore } from './session-store';
import { InMemorySessionStore } from './in-memory-session.store';
import { RedisSessionStore } from './redis-session.store';
import { buildRedisClient } from '../common/build-redis-client';

/**
 * Build the session store from config. Fail-fast: Redis config problems and
 * connection failures throw at startup (never silently fall back to memory).
 * Redis TLS (rediss://) options are handled inside buildRedisClient.
 */
export async function createSessionStore(
  config: ConfigService,
): Promise<SessionStore> {
  const ttlMs = Number(config.get('SESSION_TTL_MS'));
  // Absolute lifetime defaults to the sliding TTL so the cap can never be
  // looser than the idle bound unless an operator explicitly raises it.
  const absoluteMs = Number(
    config.get('SESSION_ABSOLUTE_TTL_MS') ?? config.get('SESSION_TTL_MS'),
  );
  if (config.get('SESSION_BACKEND') !== 'redis') {
    return new InMemorySessionStore(ttlMs, absoluteMs);
  }
  const url = config.get<string>('REDIS_URL');
  const encKey = config.get<string>('SESSION_ENC_KEY');
  if (!url) throw new Error('SESSION_BACKEND=redis but REDIS_URL is not set');
  if (!encKey)
    throw new Error('SESSION_BACKEND=redis but SESSION_ENC_KEY is not set');
  const client = buildRedisClient(url);
  await client.connect(); // resolves once the socket is ready; rejects if Redis is down
  await client.ping(); // eager connection check — fail-fast if Redis is down
  return new RedisSessionStore(client, ttlMs, encKey, absoluteMs);
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
