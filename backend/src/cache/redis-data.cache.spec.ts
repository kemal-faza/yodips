import 'reflect-metadata';
import Redis from 'ioredis';
import { RedisDataCache } from './redis-data.cache';

jest.mock('ioredis');

const mockClient = { set: jest.fn(), get: jest.fn(), del: jest.fn(), quit: jest.fn() };

let cache: RedisDataCache;
beforeEach(() => {
  jest.clearAllMocks();
  (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
  cache = new RedisDataCache(mockClient as unknown as Redis, 60_000);
});

describe('RedisDataCache', () => {
  it('set() writes SET key <json> EX ttl (ms→sec)', async () => {
    mockClient.set.mockResolvedValue('OK');
    await cache.set('u:siap:profile', { nama: 'Budi' }, 60_000);
    expect(mockClient.set).toHaveBeenCalledWith('sso:cache:u:siap:profile', '{"nama":"Budi"}', 'EX', 60);
  });
  it('get() parses the JSON value', async () => {
    mockClient.get.mockResolvedValue('[{"id":1}]');
    expect(await cache.get('u:kulon:assignments')).toEqual([{ id: 1 }]);
  });
  it('get() returns null on a Redis miss', async () => {
    mockClient.get.mockResolvedValue(null);
    expect(await cache.get('u:kulon:courses')).toBeNull();
  });
  it('del() issues DEL', async () => {
    await cache.del('u:siap:khs');
    expect(mockClient.del).toHaveBeenCalledWith('sso:cache:u:siap:khs');
  });
});