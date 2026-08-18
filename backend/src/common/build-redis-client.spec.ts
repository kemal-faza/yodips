import 'reflect-metadata';
import Redis from 'ioredis';
import { isTlsUrl, buildRedisClient } from './build-redis-client';

jest.mock('ioredis');

let nextInstance = 0;
(Redis as unknown as jest.Mock).mockImplementation(
  (url: string, opts: object) => {
    nextInstance += 1;
    return { mockUrl: url, capturedOptions: opts, _mockUid: nextInstance };
  },
);

describe('isTlsUrl', () => {
  it('true untuk skema rediss://', () => {
    expect(isTlsUrl('rediss://user:pass@host:6379')).toBe(true);
  });

  it('false untuk redis:// (tanpa TLS)', () => {
    expect(isTlsUrl('redis://127.0.0.1:6379')).toBe(false);
    expect(isTlsUrl('')).toBe(false);
  });

  it('case-insensitive', () => {
    expect(isTlsUrl('REDISS://host:6379')).toBe(true);
  });
});

describe('buildRedisClient', () => {
  it('menambah tls.rejectUnauthorized=false untuk rediss:// (Heroku Redis self-signed)', () => {
    const client = buildRedisClient('rediss://u:p@host:6379') as unknown as {
      capturedOptions: Record<string, unknown>;
    };
    expect(client.capturedOptions.tls).toEqual({ rejectUnauthorized: false });
  });

  it('TIDAK menambah opsi tls untuk redis:// (tanpa TLS)', () => {
    const client = buildRedisClient('redis://127.0.0.1:6379') as unknown as {
      capturedOptions: Record<string, unknown>;
    };
    expect(client.capturedOptions.tls).toBeUndefined();
  });

  it('mempertahankan opsi fail-fast default (lazyConnect, maxRetries, offlineQueue mati)', () => {
    const client = buildRedisClient('rediss://u@h') as unknown as {
      capturedOptions: Record<string, unknown>;
    };
    expect(client.capturedOptions).toMatchObject({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  });
});
