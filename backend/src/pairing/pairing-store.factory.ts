import { ConfigService } from '@nestjs/config';
import { buildRedisClient } from '../common/build-redis-client';
import { InMemoryPairingStore, PairingStore } from './pairing-store';
import { RedisPairingStore } from './redis-pairing.store';

/** Pilih backend store dari env (pola sama dengan createNotificationStore). */
export async function createPairingStore(
  config: ConfigService,
): Promise<PairingStore> {
  if (config.get('SESSION_BACKEND') !== 'redis') {
    return new InMemoryPairingStore();
  }
  const url = config.get<string>('REDIS_URL');
  if (!url) throw new Error('SESSION_BACKEND=redis but REDIS_URL is not set');
  const client = buildRedisClient(url);
  await client.connect();
  await client.ping();
  return new RedisPairingStore(client);
}
