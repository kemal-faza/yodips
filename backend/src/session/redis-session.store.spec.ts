import 'reflect-metadata';
import crypto = require('crypto');
import Redis from 'ioredis';
import { CapturedSession, LEGACY_CLIENT_ID, SessionRef } from './session-contract';
import { RedisSessionStore } from './redis-session.store';

jest.mock('ioredis');

const mockClient = {
  set: jest.fn(),
  get: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
  pttl: jest.fn(),
  pipeline: jest.fn(),
  quit: jest.fn(),
};

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);
const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';
const CLIENT_C = '33333333-3333-4333-8333-333333333333';

function makeSession(
  identity: string,
  kulon: string,
  sessionGeneration: string = GEN_A,
  clientId: string = CLIENT_A,
): CapturedSession {
  return {
    identity,
    clientId,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: kulon,
    siapCookie: '',
    capturedAt: Date.now(),
    sessionGeneration,
  };
}

function refFor(session: CapturedSession): SessionRef {
  return {
    sub: session.identity,
    clientId: session.clientId,
    sessionGeneration: session.sessionGeneration,
  };
}

function keyFor(identity: string, clientId: string = CLIENT_A): string {
  return `sso:session:${identity}:${clientId}`;
}

let store: RedisSessionStore;

beforeEach(() => {
  jest.clearAllMocks();
  (Redis as unknown as jest.Mock).mockImplementation(() => mockClient);
  store = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key');
});

describe('RedisSessionStore', () => {
  it('set() writes the composite key with SET envelope EX ttl (ms converted to sec for Redis)', async () => {
    mockClient.set.mockResolvedValue('OK');
    await store.set(makeSession('24060121130000', 'MoodleSession=A'));
    expect(mockClient.set).toHaveBeenCalledWith(
      'sso:session:24060121130000:11111111-1111-4111-8111-111111111111',
      expect.stringMatching(/^v1:/),
      'EX',
      1, // 1000 ms → 1 s; Redis EX/EXPIRE are in seconds
    );
  });

  it('getIfGeneration() returns the decrypted device record and slides via Lua compare-and-expire', async () => {
    const session = makeSession('24060121130000', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await store.set(session);
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.eval.mockResolvedValue(1);
    const result = await store.getIfGeneration(refFor(session));
    expect(result?.kulonCookie).toContain('MoodleSession=A');
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('EXPIRE'),
      1,
      'sso:session:24060121130000:11111111-1111-4111-8111-111111111111',
      envelope,
      expect.anything(),
    );
    expect(mockClient.expire).not.toHaveBeenCalled();

    // Hardening regression: the explicit authTagLength (16) option must stay on
    // the decipher construction. Spy on the real crypto module (never a full
    // mock) — the 4th argument of createDecipheriv is the options bag.
    const decipherSpy = jest.spyOn(crypto, 'createDecipheriv');
    try {
      await store.getIfGeneration(refFor(session));
      const options = decipherSpy.mock.calls.find((call) => call[0] === 'aes-256-gcm')?.[3];
      expect(options).toEqual({ authTagLength: 16 });
    } finally {
      decipherSpy.mockRestore();
    }
  });

  it('getIfGeneration() returns null when the key is absent', async () => {
    mockClient.get.mockResolvedValue(null);
    await expect(
      store.getIfGeneration({ sub: 'nobody', clientId: CLIENT_A, sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
    expect(mockClient.eval).not.toHaveBeenCalled();
  });

  it('getIfGeneration() CAS-cleans and returns null when the payload is tampered/corrupt', async () => {
    const tampered = 'v1:YmFk:aGFzaA==:Y2lwaGVy';
    mockClient.get.mockResolvedValue(tampered);
    mockClient.eval.mockResolvedValue(1);
    await expect(
      store.getIfGeneration({ sub: 'a', clientId: CLIENT_A, sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      keyFor('a'),
      tampered,
    );
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('stores and clears one device key without touching another', async () => {
    const kv = new Map<string, string>();
    mockClient.set.mockImplementation(async (key: string, value: string) => {
      kv.set(key, value);
      return 'OK';
    });
    mockClient.get.mockImplementation(async (key: string) => kv.get(key) ?? null);
    mockClient.eval.mockImplementation(
      async (script: string, _numKeys: number, key: string, expected: string) => {
        if (kv.get(key) !== expected) return 0;
        if (script.includes('EXPIRE')) return 1;
        if (script.includes('SET')) return 1;
        kv.delete(key);
        return 1;
      },
    );

    const a = makeSession('24060121130000', 'MoodleSession=A', GEN_A, CLIENT_A);
    const b = makeSession('24060121130000', 'MoodleSession=B', GEN_B, CLIENT_B);
    await store.set(a);
    await store.set(b);

    await expect(store.getIfGeneration(refFor(a))).resolves.toEqual(a);
    await expect(
      store.getIfGeneration({ ...refFor(a), clientId: b.clientId }),
    ).resolves.toBeNull();

    await expect(store.clearIfGeneration(refFor(a))).resolves.toBe(true);
    await expect(store.getIfGeneration(refFor(a))).resolves.toBeNull();
    await expect(store.getIfGeneration(refFor(b))).resolves.toEqual(b);
  });

  it('all() scans keys and returns only live decrypted records', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 500);
    const live = makeSession('a', 'MoodleSession=A');
    const dead = {
      ...makeSession('b', 'MoodleSession=B', GEN_B, CLIENT_B),
      capturedAt: now - 1_000,
    };
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set(live);
    const liveEnvelope = mockClient.set.mock.calls[0][1];
    await storeAbs.set(dead);
    const deadEnvelope = mockClient.set.mock.calls[1][1];

    mockClient.scan.mockResolvedValue([
      '0',
      [keyFor('a'), keyFor('b', CLIENT_B)],
    ]);
    mockClient.mget.mockResolvedValue([liveEnvelope, deadEnvelope]);
    mockClient.eval.mockResolvedValue(1);
    const result = await storeAbs.all();
    expect(result).toEqual([live]);
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      keyFor('b', CLIENT_B),
      deadEnvelope,
    );
  });

  it('listBySub() scans the per-user prefix, filters identity and returns live records', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 500);
    const a = makeSession('24060121130000', 'MoodleSession=A', GEN_A, CLIENT_A);
    const b = makeSession('24060121130000', 'MoodleSession=B', GEN_B, CLIENT_B);
    const dead = {
      ...makeSession('24060121130000', 'MoodleSession=DEAD', GEN_B, CLIENT_C),
      capturedAt: now - 1_000,
    };
    const decoy = makeSession('24060121130000-other', 'MoodleSession=OTHER', GEN_B, CLIENT_A);
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set(a);
    const aEnvelope = mockClient.set.mock.calls[0][1];
    await storeAbs.set(b);
    const bEnvelope = mockClient.set.mock.calls[1][1];
    await storeAbs.set(dead);
    const deadEnvelope = mockClient.set.mock.calls[2][1];
    await storeAbs.set(decoy);
    const decoyEnvelope = mockClient.set.mock.calls[3][1];

    mockClient.scan.mockResolvedValue([
      '0',
      [
        keyFor('24060121130000'),
        keyFor('24060121130000', CLIENT_B),
        keyFor('24060121130000', CLIENT_C),
        `sso:session:24060121130000-other:${CLIENT_A}`,
      ],
    ]);
    mockClient.mget.mockResolvedValue([aEnvelope, bEnvelope, deadEnvelope, decoyEnvelope]);
    mockClient.eval.mockResolvedValue(1);
    await expect(storeAbs.listBySub('24060121130000')).resolves.toEqual([a, b]);
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      keyFor('24060121130000', CLIENT_C),
      deadEnvelope,
    );
  });

  it('clearAllForSub() removes the composite prefix plus the old unscoped key', async () => {
    mockClient.del
      .mockResolvedValueOnce(1) // sso:session:<sub>
      .mockResolvedValueOnce(2); // composite batch
    mockClient.scan.mockResolvedValue([
      '0',
      [keyFor('NIM'), keyFor('NIM', CLIENT_B)],
    ]);
    await expect(store.clearAllForSub('NIM')).resolves.toBe(3);
    expect(mockClient.del).toHaveBeenNthCalledWith(1, 'sso:session:NIM');
    expect(mockClient.del).toHaveBeenNthCalledWith(2, keyFor('NIM'), keyFor('NIM', CLIENT_B));
  });

  it('migrates a legacy per-NIM key to <sub>:legacy with clientId legacy and preserves PTTL', async () => {
    mockClient.set.mockResolvedValue('OK');
    const legacy: CapturedSession = {
      ...makeSession('24060121130000', 'MoodleSession=LEG', 'c'.repeat(32), LEGACY_CLIENT_ID),
    };
    await store.set(legacy);
    const legacyEnvelope = mockClient.set.mock.calls[0][1];
    const oldKey = 'sso:session:24060121130000';
    const newKey = `sso:session:24060121130000:${LEGACY_CLIENT_ID}`;

    mockClient.scan.mockResolvedValue([
      '0',
      [oldKey, keyFor('24060121130000', CLIENT_A)], // composite key must be skipped
    ]);
    mockClient.get.mockImplementation(async (key: string) =>
      key === oldKey ? legacyEnvelope : null,
    );
    mockClient.pttl.mockResolvedValue(4321);

    await expect(store.migrateLegacyKeys()).resolves.toEqual({ scanned: 1, migrated: 1 });
    expect(mockClient.pttl).toHaveBeenCalledWith(oldKey);
    expect(mockClient.set).toHaveBeenLastCalledWith(
      newKey,
      expect.stringMatching(/^v1:/),
      'PX',
      4321,
    );
    expect(mockClient.del).toHaveBeenCalledWith(oldKey);

    // The migrated envelope carries clientId legacy and remains readable.
    const migratedEnvelope = mockClient.set.mock.calls[mockClient.set.mock.calls.length - 1][1];
    mockClient.get.mockResolvedValue(migratedEnvelope);
    mockClient.eval.mockResolvedValue(1);
    await expect(store.getIfGeneration(refFor(legacy))).resolves.toEqual(legacy);
  });

  it('migrateLegacyKeys() ignores already-composite keys', async () => {
    mockClient.scan.mockResolvedValue(['0', [keyFor('NIM')]]);
    await expect(store.migrateLegacyKeys()).resolves.toEqual({ scanned: 0, migrated: 0 });
    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockClient.pttl).not.toHaveBeenCalled();
  });

  it('migrateLegacyKeys() falls back to the configured TTL when PTTL is absent', async () => {
    mockClient.set.mockResolvedValue('OK');
    const legacy = makeSession('24060121130000', 'MoodleSession=LEG', GEN_A, LEGACY_CLIENT_ID);
    await store.set(legacy);
    const legacyEnvelope = mockClient.set.mock.calls[0][1];
    const oldKey = 'sso:session:24060121130000';
    const newKey = `sso:session:24060121130000:${LEGACY_CLIENT_ID}`;
    mockClient.scan.mockResolvedValue(['0', [oldKey]]);
    mockClient.get.mockImplementation(async (key: string) =>
      key === oldKey ? legacyEnvelope : null,
    );
    mockClient.pttl.mockResolvedValue(-1);
    mockClient.del.mockResolvedValue(1);

    await expect(store.migrateLegacyKeys()).resolves.toEqual({ scanned: 1, migrated: 1 });
    expect(mockClient.set).toHaveBeenLastCalledWith(
      newKey,
      expect.stringMatching(/^v1:/),
      'EX',
      1,
    );
  });

  it('migrateLegacyKeys() keeps a newer composite record and still removes the old key', async () => {
    const legacy = {
      ...makeSession('24060121130000', 'MoodleSession=OLD', GEN_A, LEGACY_CLIENT_ID),
      capturedAt: 1_000,
    };
    const newer = { ...legacy, capturedAt: 2_000 };
    mockClient.set.mockResolvedValue('OK');
    await store.set(legacy);
    const legacyEnvelope = mockClient.set.mock.calls[0][1];
    await store.set(newer);
    const newerEnvelope = mockClient.set.mock.calls[1][1];
    const oldKey = 'sso:session:24060121130000';

    mockClient.scan.mockResolvedValue(['0', [oldKey]]);
    mockClient.get.mockImplementation(async (key: string) => {
      if (key === oldKey) return legacyEnvelope;
      if (key === `sso:session:24060121130000:${LEGACY_CLIENT_ID}`) return newerEnvelope;
      return null;
    });
    mockClient.del.mockResolvedValue(1);

    await expect(store.migrateLegacyKeys()).resolves.toEqual({ scanned: 1, migrated: 0 });
    expect(mockClient.set).toHaveBeenCalledTimes(2); // only the two seeds
    expect(mockClient.del).toHaveBeenCalledWith(oldKey);
  });

  it('onModuleDestroy closes the client', async () => {
    mockClient.quit.mockImplementation(async () => 'OK');
    await store.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });

  it('getIfGeneration() returns null past the absolute lifetime even when the sliding TTL is fresh, and does NOT slide the dead key', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set({ ...session, capturedAt: now - 250 });
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.eval.mockResolvedValue(1);
    await expect(storeAbs.getIfGeneration(refFor(session))).resolves.toBeNull();
    // Dead session is CAS-DELeted (exact envelope) and must NOT be re-slid.
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET"'),
      1,
      keyFor('a'),
      envelope,
    );
    expect(mockClient.del).not.toHaveBeenCalled();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('getIfGeneration() slides the Redis TTL while within the absolute cap', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 5000);
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set({ ...session, capturedAt: now });
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.eval.mockResolvedValue(1);
    const result = await storeAbs.getIfGeneration(refFor(session));
    expect(result?.kulonCookie).toContain('MoodleSession=A');
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('EXPIRE'),
      1,
      keyFor('a'),
      envelope,
      1,
    );
  });

  it('getIfGeneration() works when absoluteMs is undefined and only the sliding TTL applies', async () => {
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await store.set(session); // store: 3-arg, no cap
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.eval.mockResolvedValue(1);
    const result = await store.getIfGeneration(refFor(session));
    expect(result?.kulonCookie).toContain('MoodleSession=A');
  });

  it('decrypt rejects a wrong-shape envelope (too few fields)', async () => {
    mockClient.get.mockResolvedValue('v1:YmFk'); // only iv — missing tag and ct
    await expect(
      store.getIfGeneration({ sub: 'a', clientId: CLIENT_A, sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('decrypt rejects a non-12-byte IV and non-16-byte tag', async () => {
    const iv8 = Buffer.alloc(8).toString('base64'); // 8-byte IV → must reject
    const tag8 = Buffer.alloc(8).toString('base64'); // 8-byte tag → must reject
    const ct = Buffer.from('ciphertext').toString('base64');
    mockClient.get.mockResolvedValue(`v1:${iv8}:${tag8}:${ct}`);
    await expect(
      store.getIfGeneration({ sub: 'a', clientId: CLIENT_A, sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('decrypt rejects an envelope with more than four fields', async () => {
    const iv = Buffer.alloc(12).toString('base64');
    const tag = Buffer.alloc(16).toString('base64');
    const ct = Buffer.from('ciphertext').toString('base64');
    mockClient.get.mockResolvedValue(`v1:${iv}:${tag}:${ct}:extra`);
    await expect(
      store.getIfGeneration({ sub: 'a', clientId: CLIENT_A, sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
  });

  it('natural re-login: a session past the absolute cap is dead, and a fresh set() for the same device is readable again', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
    // Old session captured 250ms ago > 200ms cap → dead on read (CAS-DELeted).
    const oldSession = makeSession('a', 'MoodleSession=OLD');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set({ ...oldSession, capturedAt: now - 250 });
    const oldEnvelope = mockClient.set.mock.calls[0][1];
    mockClient.get.mockResolvedValue(oldEnvelope);
    mockClient.eval.mockResolvedValue(1);
    await expect(storeAbs.getIfGeneration(refFor(oldSession))).resolves.toBeNull();

    // The user re-logins: a new handoff stores a fresh session under the SAME
    // identity/device with a current capturedAt → must be readable again.
    mockClient.set.mockResolvedValue('OK');
    const newSession = { ...makeSession('a', 'MoodleSession=NEW', GEN_B), capturedAt: Date.now() };
    await storeAbs.set(newSession);
    const newEnvelope = mockClient.set.mock.calls[1][1];
    mockClient.get.mockResolvedValue(newEnvelope);
    mockClient.eval.mockResolvedValue(1);
    const result = await storeAbs.getIfGeneration(refFor(newSession));
    expect(result?.kulonCookie).toContain('MoodleSession=NEW');
  });

  describe('clearIfGeneration (atomic CAS)', () => {
    it('clears on matching generation via Lua compare of the exact envelope', async () => {
      const session = makeSession('a', 'MoodleSession=A', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await store.set(session);
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      mockClient.eval.mockResolvedValue(1);
      await expect(store.clearIfGeneration(refFor(session))).resolves.toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        keyFor('a'),
        envelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns true without touching Redis writes when no record exists', async () => {
      mockClient.get.mockResolvedValue(null);
      await expect(
        store.clearIfGeneration({ sub: 'ghost', clientId: CLIENT_A, sessionGeneration: GEN_A }),
      ).resolves.toBe(true);
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns false on generation mismatch and never deletes', async () => {
      mockClient.set.mockResolvedValue('OK');
      const session = makeSession('a', 'MoodleSession=NEW', GEN_B);
      await store.set(session);
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      await expect(
        store.clearIfGeneration({ ...refFor(session), sessionGeneration: GEN_A }),
      ).resolves.toBe(false);
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('deterministic race: replacement between GET and CAS loses the CAS and preserves the newer session', async () => {
      // Seed gen-A envelope, then simulate a re-login (gen-B) landing between
      // the logout GET (old envelope) and the Lua CAS. The Lua layer sees a
      // different current value → returns 0 → clearIfGeneration false.
      mockClient.set.mockResolvedValue('OK');
      const oldSession = makeSession('a', 'MoodleSession=OLD', GEN_A);
      await store.set(oldSession);
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      const newSession = makeSession('a', 'MoodleSession=NEW', GEN_B);
      await store.set(newSession);
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // current != expected → not deleted
      await expect(store.clearIfGeneration(refFor(oldSession))).resolves.toBe(false);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        keyFor('a'),
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('absolute-expiry CAS race', () => {
    it('never DELs a replacement stored between GET and cleanup (Lua compare, lost CAS)', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      const session = makeSession('a', 'MoodleSession=OLD', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set({ ...session, capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      // Replacement (fresh re-login) lands after the stale GET but before cleanup.
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // CAS lost: current != old → no DEL
      await expect(storeAbs.getIfGeneration(refFor(session))).resolves.toBeNull();
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        keyFor('a'),
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
      expect(mockClient.expire).not.toHaveBeenCalled();
    });
  });

  describe('getIfGeneration (generation-qualified atomic snapshot)', () => {
    it('returns the live record only on exact match and slides via Lua compare-and-EXPIRE; mismatch returns null without slide/delete', async () => {
      const session = makeSession('a', 'MoodleSession=A', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await store.set(session);
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      mockClient.eval.mockResolvedValue(1);
      const hit = await store.getIfGeneration(refFor(session));
      expect(hit?.kulonCookie).toContain('MoodleSession=A');
      // Atomic compare-and-expire of the EXACT envelope read: never a bare
      // EXPIRE (which would slide a B-replacement's TTL on a stale A read).
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        1,
        keyFor('a'),
        envelope,
        expect.anything(),
      );
      expect(mockClient.expire).not.toHaveBeenCalled();
      mockClient.expire.mockClear();
      mockClient.eval.mockClear();
      mockClient.get.mockResolvedValue(envelope);
      await expect(
        store.getIfGeneration({ ...refFor(session), sessionGeneration: GEN_B }),
      ).resolves.toBeNull();
      expect(mockClient.expire).not.toHaveBeenCalled();
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns null for unknown identity without writes', async () => {
      mockClient.get.mockResolvedValue(null);
      await expect(
        store.getIfGeneration({ sub: 'ghost', clientId: CLIENT_A, sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      expect(mockClient.expire).not.toHaveBeenCalled();
      expect(mockClient.eval).not.toHaveBeenCalled();
    });

    it('filters by clientId at the key level (another device never satisfies the ref)', async () => {
      const a = makeSession('a', 'MoodleSession=A', GEN_A, CLIENT_A);
      mockClient.set.mockResolvedValue('OK');
      await store.set(a);
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockImplementation(async (key: string) =>
        key === keyFor('a', CLIENT_A) ? envelope : null,
      );
      mockClient.eval.mockResolvedValue(1);
      await expect(
        store.getIfGeneration({ ...refFor(a), clientId: CLIENT_B }),
      ).resolves.toBeNull();
      await expect(store.getIfGeneration(refFor(a))).resolves.toEqual(a);
    });

    it('evaluates absolute-dead BEFORE mismatch: dead record CAS-cleans the exact envelope and returns null even for the matching generation', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      const session = makeSession('a', 'MoodleSession=OLD', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set({ ...session, capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(1);
      await expect(storeAbs.getIfGeneration(refFor(session))).resolves.toBeNull();
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        keyFor('a'),
        oldEnvelope,
      );
      expect(mockClient.expire).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('clearIfGeneration absolute-dead parity', () => {
    it('dead record is CAS-cleaned and reports true when the cleanup wins (no replacement)', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      const session = makeSession('a', 'MoodleSession=OLD', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set({ ...session, capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(1);
      // Even a mismatched generation must evaluate expiry first → cleanup wins → true.
      await expect(
        storeAbs.clearIfGeneration({ ...refFor(session), sessionGeneration: GEN_B }),
      ).resolves.toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        keyFor('a'),
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('dead record with a B-replacement between GET and CAS loses the CAS and reports false (B preserved)', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      const session = makeSession('a', 'MoodleSession=OLD', GEN_A);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set({ ...session, capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // B landed → current != old
      await expect(storeAbs.clearIfGeneration(refFor(session))).resolves.toBe(false);
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('stateful Redis fake: deferred GET -> replacement -> EVAL really compares envelopes (D)', () => {
    const KEY_U = keyFor('u');

    /**
     * Minimal in-test Redis that ACTUALLY stores raw envelopes and evaluates
     * the compare-and-delete/replace Lua by string comparison — no mocked desired
     * return. Deferred hooks let the test interleave a B-replacement between
     * the store's GET and its EVAL, proving the Lua loses and B survives.
     */
    function makeStatefulClient() {
      const kv = new Map<string, string>();
      const expiries = new Map<string, number>();
      const expireCalls: Array<{ key: string; secs: number }> = [];
      let onGet: ((key: string, value: string | null) => void) | null = null;
      let onEval: ((key: string, expected: string, current: string | null) => void) | null = null;
      return {
        kv,
        expiries,
        expireCalls,
        set onGetHook(fn: typeof onGet) { onGet = fn; },
        set onEvalHook(fn: typeof onEval) { onEval = fn; },
        async set(key: string, value: string, ...args: unknown[]) {
          kv.set(key, value);
          const exAt = args.indexOf('EX');
          expiries.set(key, exAt >= 0 ? Number(args[exAt + 1]) : 0);
          return 'OK';
        },
        async get(key: string) {
          const v = kv.get(key) ?? null;
          // Defer the replacement until AFTER the value was read but BEFORE
          // the caller issues its EVAL: run the hook on next microtask so the
          // interleaving is deterministic without timers.
          if (onGet) { const hook = onGet; onGet = null; await Promise.resolve(); hook(key, v); }
          return v;
        },
        async expire(key: string, secs: number) { expireCalls.push({ key, secs }); return 1; },
        async del(key: string) { expiries.delete(key); return kv.delete(key) ? 1 : 0; },
        async eval(script: string, _n: number, key: string, expected: string, ...rest: unknown[]) {
          const current = kv.get(key) ?? null;
          if (onEval) { const hook = onEval; onEval = null; hook(key, expected, current); }
          // REALLY evaluate the comparison like Redis would — no stubbed
          // outcome: conditional EXPIRE, DEL, and SET scripts compare against
          // the live value.
          if (script.includes('redis.call("SET"')) {
            if (current === expected) {
              kv.set(key, String(rest[0]));
              expiries.set(key, Number(rest[1]));
              return 1;
            }
            return 0;
          }
          if (script.includes('EXPIRE')) {
            if (current === expected) { expiries.set(key, Number(rest[0])); return 1; }
            return 0;
          }
          if (current === expected) { kv.delete(key); expiries.delete(key); return 1; }
          return 0;
        },
        async quit() { return 'OK'; },
      };
    }

    it('guard-A vs replacement-B: clearIfGeneration(A) loses the real CAS and B remains readable', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const oldSession = makeSession('u', 'MoodleSession=OLD', GEN_A);
      await s.set(oldSession);
      const rawBefore = fake.kv.get(KEY_U)!;
      expect(rawBefore).toMatch(/^v1:/);
      // Interleave: after the logout-path GET reads the A-envelope, a re-login
      // overwrites the SAME key with a B-envelope before the EVAL runs.
      fake.onGetHook = () => {
        // Synchronous overwrite inside the hook would still precede EVAL
        // because GET awaits a microtask after invoking the hook.
        void s.set(makeSession('u', 'MoodleSession=NEW', GEN_B));
      };
      // The GET inside clearIfGeneration triggers the hook above; the EVAL
      // then compares the stale A-envelope against the live B-envelope.
      await expect(s.clearIfGeneration(refFor(oldSession))).resolves.toBe(false);
      const rawAfter = fake.kv.get(KEY_U)!;
      expect(rawAfter).not.toBe(rawBefore);
      // B is provably intact: a qualified read with B hits, with A misses.
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      expect(fake.kv.has(KEY_U)).toBe(true);
    });

    it('getIfGeneration(A) after a B-replacement misses without sliding or deleting B', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      await s.set(makeSession('u', 'MoodleSession=OLD', GEN_A));
      await s.set(makeSession('u', 'MoodleSession=NEW', GEN_B));
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      // B still live and hittable.
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
    });

    it('deferred GET -> B-replacement -> EVAL: the Lua compare loses, A is null, and B TTL is never slid', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      await s.set(makeSession('u', 'MoodleSession=OLD', GEN_A));
      // Interleave: after the qualified-read GET observes the A-envelope, a
      // re-login overwrites the SAME key with a B-envelope before the EVAL.
      fake.onGetHook = () => {
        void s.set(makeSession('u', 'MoodleSession=NEW', GEN_B));
      };
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      // CAS loss: no unconditional EXPIRE ran, and the conditional EXPIRE
      // Lua refused to touch B — B's sliding TTL is exactly what its own
      // set() wrote, and B remains live.
      expect(fake.expireCalls).toHaveLength(0);
      expect(fake.expiries.get(KEY_U)).toBe(60);
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
      expect(fake.kv.has(KEY_U)).toBe(true);
    });

    it('replaces only the SIAP cookie while preserving the full session snapshot', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = { ...makeSession('u', 'MoodleSession=OLD', GEN_A), siapCookie: 'sia_app_session=old' };
      const replacement = { ...expected, siapCookie: 'sia_app_session=new' };
      await s.set(expected);
      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('updated');
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(replacement);
    });

    it('replaces only the SSO cookie while preserving the snapshot', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = {
        ...makeSession('u', 'MoodleSession=OLD', GEN_A),
        ssoCookie: 'ci_session_sso=old',
        microsoftCookie: 'MS=keep',
        siapCookie: 'sia_app_session=keep',
      };
      const replacement = { ...expected, ssoCookie: 'ci_session_sso=new' };
      await s.set(expected);

      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('updated');
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(replacement);
    });

    it('replaces only Kulon cookie while preserving the full session snapshot fields', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = {
        ...makeSession('u', 'MoodleSession=OLD', GEN_A),
        microsoftCookie: 'MS=keep',
        siapCookie: 'sia_app_session=keep',
        emailSso: 'student@example.test',
      };
      const replacement = { ...expected, kulonCookie: 'MoodleSession=NEW' };
      await s.set(expected);

      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('updated');
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(replacement);
    });

    it('GET -> newer handoff -> EVAL returns conflict and preserves the newer generation', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = makeSession('u', 'MoodleSession=OLD', GEN_A);
      const replacement = { ...expected, kulonCookie: 'MoodleSession=RENEWED' };
      const newer = makeSession('u', 'MoodleSession=NEW-LOGIN', GEN_B);
      await s.set(expected);
      fake.onGetHook = () => { void s.set(newer); };

      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('conflict');
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({
        kulonCookie: 'MoodleSession=NEW-LOGIN',
      });
      expect(fake.kv.has(KEY_U)).toBe(true);
    });

    it('GET -> same-generation renewal -> EVAL returns conflict and preserves the newer cookie', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = makeSession('u', 'MoodleSession=OLD', GEN_A);
      const replacement = { ...expected, kulonCookie: 'MoodleSession=RENEWED' };
      const newer = { ...expected, kulonCookie: 'MoodleSession=OTHER-RENEWAL' };
      await s.set(expected);
      fake.onGetHook = () => { void s.set(newer); };

      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('conflict');
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(newer);
    });

    it('returns dead for absent records and conflict for generation mismatch without touching the live replacement', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = makeSession('u', 'MoodleSession=OLD', GEN_A);
      const replacement = { ...expected, kulonCookie: 'MoodleSession=RENEWED' };

      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('dead');
      await s.set(makeSession('u', 'MoodleSession=NEW-LOGIN', GEN_B));
      await expect(s.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('conflict');
      await expect(
        s.getIfGeneration({ sub: 'u', clientId: CLIENT_A, sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({
        kulonCookie: 'MoodleSession=NEW-LOGIN',
      });
    });

    it('rejects a no-op Kulon cookie replacement', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = makeSession('u', 'MoodleSession=OLD', GEN_A);
      await s.set(expected);

      await expect(s.replaceIfUnchanged(refFor(expected), expected, expected)).rejects.toThrow(
        'Invalid session renewal replacement',
      );
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(expected);
    });

    it('absolute lifetime expiry is dead and never renews the envelope', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key', 20);
      const expired = { ...makeSession('u', 'MoodleSession=OLD', GEN_A), capturedAt: Date.now() - 30 };
      await s.set(expired);

      await expect(
        s.replaceIfUnchanged(refFor(expired), expired, { ...expired, kulonCookie: 'MoodleSession=NEW' }),
      ).resolves.toBe('dead');
      expect(fake.kv.has(KEY_U)).toBe(false);
    });

    it('rejects an empty renewed Kulon cookie without replacing the stored session', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      const expected = makeSession('u', 'MoodleSession=OLD', GEN_A);
      await s.set(expected);

      await expect(
        s.replaceIfUnchanged(refFor(expected), expected, { ...expected, kulonCookie: '' }),
      ).rejects.toThrow('Invalid session renewal replacement');
      await expect(s.getIfGeneration(refFor(expected))).resolves.toEqual(expected);
    });
  });
});
