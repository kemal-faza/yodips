import { ConfigService } from '@nestjs/config';
import { buildRedisClient } from '../common/build-redis-client';
import { InMemoryNotificationStore, NotificationStore } from './notification-store';
import { RedisNotificationStore } from './redis-notification.store';

/** Pilih backend store dari env (pola sama dengan CacheModule.createDataCache). */
export async function createNotificationStore(
  config: ConfigService,
): Promise<NotificationStore> {
  if (config.get('SESSION_BACKEND') !== 'redis') {
    return new InMemoryNotificationStore();
  }
  const url = config.get<string>('REDIS_URL');
  if (!url) throw new Error('SESSION_BACKEND=redis but REDIS_URL is not set');
  const client = buildRedisClient(url);
  await client.connect();
  await client.ping();
  return new RedisNotificationStore(client);
}
