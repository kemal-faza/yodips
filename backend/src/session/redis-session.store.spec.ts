import 'reflect-metadata';
import Redis from 'ioredis';
import { RedisSessionStore } from './redis-session.store';

jest.mock('ioredis');

const mockClient = {
  set: jest.fn(),
  get: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
  pipeline: jest.fn(),
  quit: jest.fn(),
};

function makeSession(identity: string, kulon: string) {
  return {
    identity,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: kulon,
    siapCookie: '',
    capturedAt: Date.now(),
  };
}

let store: RedisSessionStore;

beforeEach(() => {
  jest.clearAllMocks();
  (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
  store = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key');
});

describe('RedisSessionStore', () => {
  it('set() writes SET key envelope EX ttl (ms converted to sec for Redis)', async () => {
    mockClient.set.mockResolvedValue('OK');
    await store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    expect(mockClient.set).toHaveBeenCalledWith(
      'sso:session:24060121130000',
      expect.stringMatching(/^v1:/),
      'EX',
      1, // 1000 ms → 1 s; Redis EX/EXPIRE are in seconds
    );
  });

  it('get() returns the decrypted session and applies sliding EXPIRE', async () => {
    const session = makeSession('24060121130000', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await store.set('24060121130000', session);
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.expire.mockResolvedValue(1);
    const result = await store.get('24060121130000');
    expect(result?.kulonCookie).toContain('MoodleSession=A');
    expect(mockClient.expire).toHaveBeenCalledWith('sso:session:24060121130000', 1);
  });

  it('get() returns null when the key is absent', async () => {
    mockClient.get.mockResolvedValue(null);
    expect(await store.get('nobody')).toBeNull();
  });

  it('get() returns null when the payload is tampered/corrupt', async () => {
    mockClient.get.mockResolvedValue('v1:YmFk:aGFzaA==:Y2lwaGVy');
    expect(await store.get('a')).toBeNull();
  });

  it('clear() issues DEL', async () => {
    mockClient.del.mockResolvedValue(1);
    await store.clear('a');
    expect(mockClient.del).toHaveBeenCalledWith('sso:session:a');
  });

  it('all() scans keys and returns decrypted sessions', async () => {
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await store.set('a', session);
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.scan.mockResolvedValue(['0', ['sso:session:a']]);
    mockClient.mget.mockResolvedValue([envelope]);
    const result = await store.all();
    expect(result.map((s) => s.identity)).toEqual(['a']);
  });

  it('onModuleDestroy closes the client', async () => {
    mockClient.quit.mockImplementation(async () => 'OK');
    await store.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });
});