import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createSessionStore } from './session.module';
import { InMemorySessionStore } from './in-memory-session.store';
import { RedisSessionStore } from './redis-session.store';

jest.mock('ioredis');

const mockClient = {
  set: jest.fn(),
  get: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
  pttl: jest.fn(),
  pipeline: jest.fn(),
  quit: jest.fn(),
  ping: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
};

const CLIENT_A = 'client-a';

function config(overrides: Record<string, string>): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? null,
  } as unknown as ConfigService;
}

const GEN_FIX = 'c'.repeat(32);

describe('createSessionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.scan.mockResolvedValue(['0', []]);
  });

  it('returns InMemorySessionStore when SESSION_BACKEND is memory (default)', async () => {
    const store = await createSessionStore(
      config({ SESSION_TTL_MS: '604800000' }),
    );
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('returns RedisSessionStore when SESSION_BACKEND is redis and pings ok', async () => {
    (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
    mockClient.ping.mockResolvedValue('PONG');
    const store = await createSessionStore(
      config({
        SESSION_BACKEND: 'redis',
        REDIS_URL: 'redis://127.0.0.1:6379',
        SESSION_ENC_KEY: 'some-key',
        SESSION_TTL_MS: '604800000',
      }),
    );
    expect(store).toBeInstanceOf(RedisSessionStore);
    expect(mockClient.ping).toHaveBeenCalled();
  });

  it('throws when redis backend but REDIS_URL missing', async () => {
    await expect(
      createSessionStore(config({ SESSION_BACKEND: 'redis', SESSION_ENC_KEY: 'k' })),
    ).rejects.toThrow('REDIS_URL');
  });

  it('throws when redis backend but SESSION_ENC_KEY missing', async () => {
    await expect(
      createSessionStore(config({ SESSION_BACKEND: 'redis', REDIS_URL: 'redis://x' })),
    ).rejects.toThrow('SESSION_ENC_KEY');
  });

  it('throws when redis backend and ping fails (Redis down)', async () => {
    (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
    mockClient.ping.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      createSessionStore(
        config({
          SESSION_BACKEND: 'redis',
          REDIS_URL: 'redis://127.0.0.1:6379',
          SESSION_ENC_KEY: 'k',
        }),
      ),
    ).rejects.toThrow('connect ECONNREFUSED');
  });

  it('forwards SESSION_ABSOLUTE_TTL_MS to the in-memory store (absolute cap enforced)', async () => {
    const now = Date.now();
    const store = (await createSessionStore(
      config({
        SESSION_TTL_MS: '604800000',
        SESSION_ABSOLUTE_TTL_MS: '200',
      }),
    )) as InMemorySessionStore;
    await store.set({
      identity: 'a',
      clientId: CLIENT_A,
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'K',
      siapCookie: '',
      capturedAt: now - 250,
      sessionGeneration: GEN_FIX,
    });
    // 250ms elapsed > 200ms cap → dead even though the 7-day sliding TTL is fresh.
    expect(
      await store.getIfGeneration({
        sub: 'a',
        clientId: CLIENT_A,
        sessionGeneration: GEN_FIX,
      }),
    ).toBeNull();
  });

  it('defaults the absolute cap to SESSION_TTL_MS when SESSION_ABSOLUTE_TTL_MS is unset', async () => {
    const now = Date.now();
    const store = (await createSessionStore(
      config({ SESSION_TTL_MS: '60000' }),
    )) as InMemorySessionStore;
    await store.set({
      identity: 'a',
      clientId: CLIENT_A,
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'K',
      siapCookie: '',
      capturedAt: now - 61_000, // older than the 60s default cap
      sessionGeneration: GEN_FIX,
    });
    expect(
      await store.getIfGeneration({
        sub: 'a',
        clientId: CLIENT_A,
        sessionGeneration: GEN_FIX,
      }),
    ).toBeNull();
  });

  it('runs the legacy migration after connecting and still boots when it fails', async () => {
    (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
    mockClient.ping.mockResolvedValue('PONG');
    mockClient.scan.mockRejectedValue(new Error('scan unavailable'));

    const store = await createSessionStore(
      config({
        SESSION_BACKEND: 'redis',
        REDIS_URL: 'redis://127.0.0.1:6379',
        SESSION_ENC_KEY: 'some-key',
        SESSION_TTL_MS: '604800000',
      }),
    );

    expect(store).toBeInstanceOf(RedisSessionStore);
    expect(mockClient.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'sso:session:*',
      'COUNT',
      expect.any(Number),
    );
  });
});
