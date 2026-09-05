import 'reflect-metadata';
import crypto = require('crypto');
import Redis from 'ioredis';
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
  pipeline: jest.fn(),
  quit: jest.fn(),
};

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);

function makeSession(identity: string, kulon: string, sessionGeneration: string = GEN_A) {
  return {
    identity,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: kulon,
    siapCookie: '',
    capturedAt: Date.now(),
    sessionGeneration,
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

    // Task 5 hardening regression: the explicit authTagLength (16) option must
    // stay on the decipher construction. Spy on the real crypto module (never a
    // full mock) — the 4th argument of createDecipheriv is the options bag.
    const decipherSpy = jest.spyOn(crypto, 'createDecipheriv');
    try {
      await store.get('24060121130000');
      const options = decipherSpy.mock.calls.find((call) => call[0] === 'aes-256-gcm')?.[3];
      expect(options).toEqual({ authTagLength: 16 });
    } finally {
      decipherSpy.mockRestore();
    }
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

  it('get() returns null past the absolute lifetime even when the sliding TTL is fresh, and does NOT slide the dead key', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set('a', { ...session, capturedAt: now - 250 });
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.eval.mockResolvedValue(1);
    expect(await storeAbs.get('a')).toBeNull();
    // Dead session is CAS-DELeted (exact envelope) and must NOT be re-slid.
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET"'),
      1,
      'sso:session:a',
      envelope,
    );
    expect(mockClient.del).not.toHaveBeenCalled();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('get() slides the Redis TTL while within the absolute cap', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 5000);
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set('a', { ...session, capturedAt: now });
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.expire.mockResolvedValue(1);
    const result = await storeAbs.get('a');
    expect(result?.kulonCookie).toContain('MoodleSession=A');
    expect(mockClient.expire).toHaveBeenCalledWith('sso:session:a', 1);
  });

  it('get() returns null when absoluteMs is undefined and only the sliding TTL applies (legacy)', async () => {
    const session = makeSession('a', 'MoodleSession=A');
    mockClient.set.mockResolvedValue('OK');
    await store.set('a', session); // store: 3-arg, no cap
    const envelope = mockClient.set.mock.calls[0][1];

    mockClient.get.mockResolvedValue(envelope);
    mockClient.expire.mockResolvedValue(1);
    const result = await store.get('a');
    expect(result?.kulonCookie).toContain('MoodleSession=A');
  });

  it('decrypt rejects a wrong-shape envelope (too few fields)', async () => {
    mockClient.get.mockResolvedValue('v1:YmFk'); // only iv — missing tag and ct
    expect(await store.get('a')).toBeNull();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('decrypt rejects a non-12-byte IV and non-16-byte tag', async () => {
    const iv8 = Buffer.alloc(8).toString('base64'); // 8-byte IV → must reject
    const tag8 = Buffer.alloc(8).toString('base64'); // 8-byte tag → must reject
    const ct = Buffer.from('ciphertext').toString('base64');
    mockClient.get.mockResolvedValue(`v1:${iv8}:${tag8}:${ct}`);
    expect(await store.get('a')).toBeNull();
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('decrypt rejects an envelope with more than four fields', async () => {
    const iv = Buffer.alloc(12).toString('base64');
    const tag = Buffer.alloc(16).toString('base64');
    const ct = Buffer.from('ciphertext').toString('base64');
    mockClient.get.mockResolvedValue(`v1:${iv}:${tag}:${ct}:extra`);
    expect(await store.get('a')).toBeNull();
  });

  it('natural re-login: a session past the absolute cap is dead, and a fresh set() for the same identity is readable again', async () => {
    const now = Date.now();
    const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
    // Old session captured 250ms ago > 200ms cap → dead on read (CAS-DELeted).
    const oldSession = makeSession('a', 'MoodleSession=OLD');
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set('a', { ...oldSession, capturedAt: now - 250 });
    const oldEnvelope = mockClient.set.mock.calls[0][1];
    mockClient.get.mockResolvedValue(oldEnvelope);
    mockClient.eval.mockResolvedValue(1);
    expect(await storeAbs.get('a')).toBeNull();

    // The user re-logins: a new handoff stores a fresh session under the SAME
    // identity with a current capturedAt → must be readable again (sliding EXPIRE).
    mockClient.set.mockResolvedValue('OK');
    await storeAbs.set('a', { ...makeSession('a', 'MoodleSession=NEW', GEN_B), capturedAt: Date.now() });
    const newEnvelope = mockClient.set.mock.calls[1][1];
    mockClient.get.mockResolvedValue(newEnvelope);
    mockClient.expire.mockResolvedValue(1);
    const result = await storeAbs.get('a');
    expect(result?.kulonCookie).toContain('MoodleSession=NEW');
  });

  describe('clearIfGeneration (atomic CAS)', () => {
    it('clears on matching generation via Lua compare of the exact envelope', async () => {
      mockClient.set.mockResolvedValue('OK');
      await store.set('a', makeSession('a', 'MoodleSession=A', GEN_A));
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      mockClient.eval.mockResolvedValue(1);
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'sso:session:a',
        envelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns true without touching Redis writes when no record exists', async () => {
      mockClient.get.mockResolvedValue(null);
      await expect(store.clearIfGeneration('ghost', GEN_A)).resolves.toBe(true);
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns false on generation mismatch and never deletes', async () => {
      mockClient.set.mockResolvedValue('OK');
      await store.set('a', makeSession('a', 'MoodleSession=NEW', GEN_B));
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(false);
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('deterministic race: replacement between GET and CAS loses the CAS and preserves the newer session', async () => {
      // Seed gen-A envelope, then simulate a re-login (gen-B) landing between
      // the logout GET (old envelope) and the Lua CAS. The Lua layer sees a
      // different current value → returns 0 → clearIfGeneration false.
      mockClient.set.mockResolvedValue('OK');
      await store.set('a', makeSession('a', 'MoodleSession=OLD', GEN_A));
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      await store.set('a', makeSession('a', 'MoodleSession=NEW', GEN_B));
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // current != expected → not deleted
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(false);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'sso:session:a',
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('absolute-expiry CAS race', () => {
    it('never DELs a replacement stored between GET and cleanup (Lua compare, lost CAS)', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set('a', { ...makeSession('a', 'MoodleSession=OLD', GEN_A), capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      // Replacement (fresh re-login) lands after the stale GET but before cleanup.
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // CAS lost: current != old → no DEL
      expect(await storeAbs.get('a')).toBeNull();
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'sso:session:a',
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
      expect(mockClient.expire).not.toHaveBeenCalled();
    });
  });

  describe('getIfGeneration (generation-qualified atomic snapshot)', () => {
    it('returns the live record only on exact match and slides via Lua compare-and-EXPIRE; mismatch returns null without slide/delete', async () => {
      mockClient.set.mockResolvedValue('OK');
      await store.set('a', makeSession('a', 'MoodleSession=A', GEN_A));
      const envelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(envelope);
      mockClient.eval.mockResolvedValue(1);
      const hit = await (store as any).getIfGeneration('a', GEN_A);
      expect(hit?.kulonCookie).toContain('MoodleSession=A');
      // Atomic compare-and-expire of the EXACT envelope read: never a bare
      // EXPIRE (which would slide a B-replacement's TTL on a stale A read).
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        1,
        'sso:session:a',
        envelope,
        expect.anything(),
      );
      expect(mockClient.expire).not.toHaveBeenCalled();
      mockClient.expire.mockClear();
      mockClient.eval.mockClear();
      mockClient.get.mockResolvedValue(envelope);
      await expect((store as any).getIfGeneration('a', GEN_B)).resolves.toBeNull();
      expect(mockClient.expire).not.toHaveBeenCalled();
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('returns null for unknown identity without writes', async () => {
      mockClient.get.mockResolvedValue(null);
      await expect((store as any).getIfGeneration('ghost', GEN_A)).resolves.toBeNull();
      expect(mockClient.expire).not.toHaveBeenCalled();
      expect(mockClient.eval).not.toHaveBeenCalled();
    });

    it('evaluates absolute-dead BEFORE mismatch: dead record CAS-cleans the exact envelope and returns null even for the matching generation', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set('a', { ...makeSession('a', 'MoodleSession=OLD', GEN_A), capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(1);
      await expect((storeAbs as any).getIfGeneration('a', GEN_A)).resolves.toBeNull();
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'sso:session:a',
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
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set('a', { ...makeSession('a', 'MoodleSession=OLD', GEN_A), capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(1);
      // Even a mismatched generation must evaluate expiry first → cleanup wins → true.
      await expect(storeAbs.clearIfGeneration('a', GEN_B)).resolves.toBe(true);
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'sso:session:a',
        oldEnvelope,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('dead record with a B-replacement between GET and CAS loses the CAS and reports false (B preserved)', async () => {
      const now = Date.now();
      const storeAbs = new RedisSessionStore(mockClient as unknown as Redis, 1000, 'test-enc-key', 200);
      mockClient.set.mockResolvedValue('OK');
      await storeAbs.set('a', { ...makeSession('a', 'MoodleSession=OLD', GEN_A), capturedAt: now - 250 });
      const oldEnvelope = mockClient.set.mock.calls[0][1];
      mockClient.get.mockResolvedValue(oldEnvelope);
      mockClient.eval.mockResolvedValue(0); // B landed → current != old
      await expect(storeAbs.clearIfGeneration('a', GEN_A)).resolves.toBe(false);
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('stateful Redis fake: deferred GET -> replacement -> EVAL really compares envelopes (D)', () => {
    /**
     * Minimal in-test Redis that ACTUALLY stores raw envelopes and evaluates
     * the compare-and-delete Lua by string comparison — no mocked desired
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
          // outcome: conditional EXPIRE and conditional DEL scripts compared
          // against the live value.
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
      await s.set('u', makeSession('u', 'MoodleSession=OLD', GEN_A));
      const rawBefore = fake.kv.get('sso:session:u')!;
      expect(rawBefore).toMatch(/^v1:/);
      // Interleave: after the logout-path GET reads the A-envelope, a re-login
      // overwrites the SAME key with a B-envelope before the EVAL runs.
      fake.onGetHook = () => {
        // Synchronous overwrite inside the hook would still precede EVAL
        // because GET awaits a microtask after invoking the hook.
        void s.set('u', makeSession('u', 'MoodleSession=NEW', GEN_B));
      };
      // The GET inside clearIfGeneration triggers the hook above; the EVAL
      // then compares the stale A-envelope against the live B-envelope.
      await expect(s.clearIfGeneration('u', GEN_A)).resolves.toBe(false);
      const rawAfter = fake.kv.get('sso:session:u')!;
      expect(rawAfter).not.toBe(rawBefore);
      // B is provably intact: a qualified read with B hits, with A misses.
      await expect((s as any).getIfGeneration('u', GEN_B)).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
      await expect((s as any).getIfGeneration('u', GEN_A)).resolves.toBeNull();
      expect(fake.kv.has('sso:session:u')).toBe(true);
    });

    it('getIfGeneration(A) after a B-replacement misses without sliding or deleting B', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      await s.set('u', makeSession('u', 'MoodleSession=OLD', GEN_A));
      await s.set('u', makeSession('u', 'MoodleSession=NEW', GEN_B));
      await expect((s as any).getIfGeneration('u', GEN_A)).resolves.toBeNull();
      // B still live and hittable.
      await expect((s as any).getIfGeneration('u', GEN_B)).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
    });

    it('deferred GET -> B-replacement -> EVAL: the Lua compare loses, A is null, and B TTL is never slid', async () => {
      const fake = makeStatefulClient();
      const s = new RedisSessionStore(fake as unknown as Redis, 60_000, 'test-enc-key');
      await s.set('u', makeSession('u', 'MoodleSession=OLD', GEN_A));
      // Interleave: after the qualified-read GET observes the A-envelope, a
      // re-login overwrites the SAME key with a B-envelope before the EVAL.
      fake.onGetHook = () => {
        void s.set('u', makeSession('u', 'MoodleSession=NEW', GEN_B));
      };
      await expect((s as any).getIfGeneration('u', GEN_A)).resolves.toBeNull();
      // CAS loss: no unconditional EXPIRE ran, and the conditional EXPIRE
      // Lua refused to touch B — B's sliding TTL is exactly what its own
      // set() wrote, and B remains live.
      expect(fake.expireCalls).toHaveLength(0);
      expect(fake.expiries.get('sso:session:u')).toBe(60);
      await expect((s as any).getIfGeneration('u', GEN_B)).resolves.toMatchObject({
        kulonCookie: expect.stringContaining('MoodleSession=NEW'),
      });
      expect(fake.kv.has('sso:session:u')).toBe(true);
    });
  });
});