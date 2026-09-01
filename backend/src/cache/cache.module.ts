import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObservabilityModule } from '../observability/observability.module';
import { TELEMETRY_RUNTIME, type TelemetryRuntime } from '../observability/telemetry';
import { DataCache } from './data-cache';
import { InMemoryDataCache } from './in-memory-data.cache';
import { RedisDataCache } from './redis-data.cache';
import { buildRedisClient } from '../common/build-redis-client';

export async function createDataCache(
  config: ConfigService,
  runtime?: TelemetryRuntime,
): Promise<DataCache> {
  const rawTtl: unknown = config.get('CACHE_TTL_MS') ?? 300_000;
  const ttlMs = Number(rawTtl);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new Error('CACHE_TTL_MS must be a positive number');
  if (config.get('SESSION_BACKEND') !== 'redis')
    return new InMemoryDataCache(ttlMs, runtime);
  const url = config.get<string>('REDIS_URL');
  if (!url) throw new Error('SESSION_BACKEND=redis but REDIS_URL is not set');
  const client = buildRedisClient(url);
  await client.connect();
  await client.ping();
  return new RedisDataCache(client, ttlMs, runtime);
}

@Global()
@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      provide: DataCache,
      inject: [ConfigService, TELEMETRY_RUNTIME],
      useFactory: createDataCache,
    },
  ],
  exports: [DataCache],
})
export class CacheModule {}
