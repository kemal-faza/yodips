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
  it('set() writes envelope JSON with EX ttl (ms→sec)', async () => {
    mockClient.set.mockResolvedValue('OK');
    await cache.set('u:siap:profile', { nama: 'Budi' }, 60_000);
    const [key, raw, exFlag, ttlSec] = mockClient.set.mock.calls[0];
    expect(key).toBe('sso:cache:u:siap:profile');
    expect(exFlag).toBe('EX');
    expect(ttlSec).toBe(60);
    const parsed = JSON.parse(raw as string) as { v: { nama: string }; fa: number; ex: number };
    expect(parsed.v).toEqual({ nama: 'Budi' });
    expect(typeof parsed.fa).toBe('number');
    expect(typeof parsed.ex).toBe('number');
  });
  it('get() unwraps the envelope and returns the bare value', async () => {
    const env = JSON.stringify({ v: [{ id: 1 }], fa: Date.now(), ex: Date.now() + 60_000 });
    mockClient.get.mockResolvedValue(env);
    expect(await cache.get('u:kulon:assignments')).toEqual([{ id: 1 }]);
  });
  it('get() parses legacy bare JSON (no fa) as null (treated as miss)', async () => {
    mockClient.get.mockResolvedValue('[{"id":1}]');
    expect(await cache.get('u:kulon:assignments')).toBeNull();
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
