import 'reflect-metadata';
import { InMemorySessionStore } from './in-memory-session.store';
import { generateSessionGeneration, type CapturedSession, type SessionRef } from './session-contract';

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);

function makeSession(
  identity: string,
  kulon: string,
  sessionGeneration: string = GEN_A,
  clientId: string = 'client-a',
  capturedAt: number = Date.now(),
): CapturedSession {
  return {
    identity,
    clientId,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: kulon,
    siapCookie: '',
    capturedAt,
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

describe('InMemorySessionStore (per-device, TTL)', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore(1000); // 1s TTL
  });

  it('stores and retrieves a session per identity and device', async () => {
    const session = makeSession('24060121130000', 'MoodleSession=A');
    await store.set(session);
    const s = await store.getIfGeneration(refFor(session));
    expect(s?.kulonCookie).toContain('MoodleSession=A');
  });

  it('isolates different identities', async () => {
    const a = makeSession('24060121130000', 'MoodleSession=A');
    const b = makeSession('24060121130001', 'MoodleSession=B', GEN_B);
    await store.set(a);
    await store.set(b);
    expect((await store.getIfGeneration(refFor(a)))?.kulonCookie).toContain('MoodleSession=A');
    expect((await store.getIfGeneration(refFor(b)))?.kulonCookie).toContain('MoodleSession=B');
  });

  it('isolates two device records and clears only the requested ref', async () => {
    const a = makeSession('24060121130000', 'MoodleSession=A', GEN_A, 'client-a');
    const b = makeSession('24060121130000', 'MoodleSession=B', GEN_B, 'client-b');
    await store.set(a);
    await store.set(b);

    expect(await store.getIfGeneration(refFor(a))).toEqual(a);
    expect(
      await store.getIfGeneration({
        sub: a.identity,
        clientId: 'client-b',
        sessionGeneration: a.sessionGeneration,
      }),
    ).toBeNull();
    expect(await store.listBySub(a.identity)).toHaveLength(2);

    await store.clearIfGeneration(refFor(a));
    expect(await store.listBySub(a.identity)).toEqual([b]);
    expect(await store.getIfGeneration(refFor(b))).toEqual(b);
  });

  it('returns null for an unknown identity', async () => {
    expect(
      await store.getIfGeneration({ sub: 'nobody', clientId: 'client-a', sessionGeneration: GEN_A }),
    ).toBeNull();
  });

  it('clears a single identity/device', async () => {
    const a = makeSession('a', 'A');
    const b = makeSession('b', 'B', GEN_B, 'client-b');
    await store.set(a);
    await store.set(b);
    await store.clearIfGeneration(refFor(a));
    expect(await store.getIfGeneration(refFor(a))).toBeNull();
    expect(await store.getIfGeneration(refFor(b))).not.toBeNull();
  });

  it('clears all records for one sub only', async () => {
    await store.set(makeSession('24060121130000', 'A', GEN_A, 'client-a'));
    await store.set(makeSession('24060121130000', 'B', GEN_B, 'client-b'));
    const other = makeSession('24060121130001', 'C', 'c'.repeat(32), 'other');
    await store.set(other);

    expect(await store.clearAllForSub('24060121130000')).toBe(2);
    expect(await store.listBySub('24060121130000')).toEqual([]);
    expect(await store.listBySub('24060121130001')).toEqual([other]);
  });

  it('all() returns all stored sessions', async () => {
    await store.set(makeSession('a', 'A'));
    await store.set(makeSession('b', 'B', GEN_B, 'client-b'));
    expect((await store.all()).map((s) => s.identity).sort()).toEqual(['a', 'b']);
  });

  it('all() filters absolute-dead records', async () => {
    const storeAbs = new InMemorySessionStore(60_000, 1_000);
    await storeAbs.set(makeSession('old', 'A', GEN_A, 'client-a', Date.now() - 2_000));
    expect(await storeAbs.all()).toEqual([]);
  });

  it('returns null once a session has expired (TTL)', async () => {
    store = new InMemorySessionStore(20);
    const session = makeSession('a', 'A');
    await store.set(session);
    await new Promise((r) => setTimeout(r, 30));
    expect(await store.getIfGeneration(refFor(session))).toBeNull();
  });

  it('sliding TTL: a qualified read keeps a session alive', async () => {
    store = new InMemorySessionStore(30);
    const session = makeSession('a', 'A');
    await store.set(session);
    await new Promise((r) => setTimeout(r, 15));
    await store.getIfGeneration(refFor(session));
    await new Promise((r) => setTimeout(r, 15));
    expect(await store.getIfGeneration(refFor(session))).not.toBeNull();
  });

  it('set() overwrites an existing session and refreshes TTL', async () => {
    store = new InMemorySessionStore(20);
    const session = makeSession('a', 'MoodleSession=A');
    await store.set(session);
    await store.set({ ...session, kulonCookie: 'MoodleSession=B' });
    expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=B');
  });

  it('absolute cap: a qualified read returns null once capturedAt + absoluteMs passes, even while the sliding TTL is fresh', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 200); // sliding 1s, absolute 200ms
    const session = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a', now - 250);
    await store.set(session);
    expect(await store.getIfGeneration(refFor(session))).toBeNull();
  });

  it('absolute cap: a qualified read returns the session while within the cap', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 1000);
    const session = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a', now);
    await store.set(session);
    expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=A');
  });

  it('absolute cap: a qualified read slides the TTL when within the cap (sliding semantics preserved)', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 1000);
    const session = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a', now - 500);
    await store.set(session);
    // First read must succeed (within the cap) and re-arm expiresAt.
    expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=A');
    // Access does NOT extend the absolute bound: past 1000ms from capturedAt it dies.
    await new Promise((r) => setTimeout(r, 600));
    expect(await store.getIfGeneration(refFor(session))).toBeNull();
  });

  it('absolute cap disabled when absoluteMs is undefined (legacy sliding-only behavior)', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000); // no absolute cap
    const session = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a', now - 5000);
    await store.set(session);
    expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=A');
  });

  it('natural re-login: a session past the absolute cap is dead, and a fresh set() for the same device is readable again', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 200); // sliding 1s, absolute 200ms
    const old = makeSession('a', 'MoodleSession=OLD', GEN_A, 'client-a', now - 250);
    await store.set(old);
    expect(await store.getIfGeneration(refFor(old))).toBeNull();
    // The user re-logins: a new handoff stores a fresh session under the SAME
    // device with a current capturedAt → must be readable again.
    const fresh = makeSession('a', 'MoodleSession=NEW', GEN_B, 'client-a');
    await store.set(fresh);
    expect((await store.getIfGeneration(refFor(fresh)))?.kulonCookie).toContain('MoodleSession=NEW');
  });

  describe('clearIfGeneration (atomic compare-and-clear)', () => {
    it('clears when the device and generation match and returns true', async () => {
      const session = makeSession('a', 'A', GEN_A);
      await store.set(session);
      await expect(store.clearIfGeneration(refFor(session))).resolves.toBe(true);
      expect(await store.getIfGeneration(refFor(session))).toBeNull();
    });

    it('is idempotent when no record exists (true, nothing cleared)', async () => {
      await expect(
        store.clearIfGeneration({ sub: 'ghost', clientId: 'client-a', sessionGeneration: GEN_A }),
      ).resolves.toBe(true);
    });

    it('never clears a NEWER live record on generation mismatch (false, record survives)', async () => {
      const session = makeSession('a', 'MoodleSession=NEW', GEN_B);
      await store.set(session);
      await expect(
        store.clearIfGeneration({ sub: 'a', clientId: session.clientId, sessionGeneration: GEN_A }),
      ).resolves.toBe(false);
      expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=NEW');
    });

    it('never clears another device record on the same sub', async () => {
      const a = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a');
      const b = makeSession('a', 'MoodleSession=B', GEN_B, 'client-b');
      await store.set(a);
      await store.set(b);
      await store.clearIfGeneration(refFor(a));
      expect(await store.getIfGeneration(refFor(b))).toEqual(b);
    });

    it('deterministic race: replacement between read and logout never clears the newer session', async () => {
      // Seed gen-A, read it (simulating logout's pre-read), then a re-login
      // overwrites with gen-B BEFORE the compare-and-clear runs.
      const old = makeSession('a', 'MoodleSession=OLD', GEN_A);
      const fresh = makeSession('a', 'MoodleSession=NEW', GEN_B);
      await store.set(old);
      const staleRead = await store.getIfGeneration(refFor(old));
      expect(staleRead?.sessionGeneration).toBe(GEN_A);
      await store.set(fresh);
      // Logout with the STALE generation must lose the CAS and preserve NEW.
      await expect(
        store.clearIfGeneration({ sub: 'a', clientId: 'client-a', sessionGeneration: GEN_A }),
      ).resolves.toBe(false);
      expect((await store.getIfGeneration(refFor(fresh)))?.kulonCookie).toContain('MoodleSession=NEW');
      // Logout with the CURRENT generation succeeds.
      await expect(store.clearIfGeneration(refFor(fresh))).resolves.toBe(true);
      expect(await store.getIfGeneration(refFor(fresh))).toBeNull();
    });

    it('treats an expired record as absent (true, no generation check)', async () => {
      store = new InMemorySessionStore(20);
      const session = makeSession('a', 'A', GEN_A);
      await store.set(session);
      await new Promise((r) => setTimeout(r, 30));
      await expect(
        store.clearIfGeneration({ sub: 'a', clientId: 'client-a', sessionGeneration: 'f'.repeat(32) }),
      ).resolves.toBe(true);
    });

    it('generateSessionGeneration produces 128-bit lowercase hex without timestamp coupling', () => {
      const g1 = generateSessionGeneration();
      const g2 = generateSessionGeneration();
      expect(g1).toMatch(/^[0-9a-f]{32}$/);
      expect(g2).toMatch(/^[0-9a-f]{32}$/);
      expect(g1).not.toBe(g2);
    });
  });

  describe('getIfGeneration (device+generation-qualified atomic snapshot)', () => {
    it('returns the live record only on exact generation match (and slides TTL)', async () => {
      const session = makeSession('a', 'MoodleSession=A', GEN_A);
      await store.set(session);
      const hit = await store.getIfGeneration(refFor(session));
      expect(hit?.kulonCookie).toContain('MoodleSession=A');
      const miss = await store.getIfGeneration({
        sub: 'a',
        clientId: 'client-a',
        sessionGeneration: GEN_B,
      });
      expect(miss).toBeNull();
      // Mismatch must NOT destroy the live record.
      expect((await store.getIfGeneration(refFor(session)))?.kulonCookie).toContain('MoodleSession=A');
    });

    it('returns null for a different device on the same sub', async () => {
      const a = makeSession('a', 'MoodleSession=A', GEN_A, 'client-a');
      await store.set(a);
      await expect(
        store.getIfGeneration({ sub: 'a', clientId: 'client-b', sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      expect(await store.getIfGeneration(refFor(a))).toEqual(a);
    });

    it('returns null for unknown identity', async () => {
      await expect(
        store.getIfGeneration({ sub: 'ghost', clientId: 'client-a', sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
    });

    it('returns null for a legacy record without generation (never matches)', async () => {
      const session = { ...makeSession('a', 'A', GEN_A), sessionGeneration: undefined as never };
      await store.set(session);
      await expect(store.getIfGeneration(refFor(makeSession('a', 'A')))).resolves.toBeNull();
    });

    it('treats expired/absolute-dead records as absent before the mismatch check', async () => {
      store = new InMemorySessionStore(20);
      const session = makeSession('a', 'A', GEN_A);
      await store.set(session);
      await new Promise((r) => setTimeout(r, 30));
      await expect(
        store.getIfGeneration({ sub: 'a', clientId: 'client-a', sessionGeneration: 'f'.repeat(32) }),
      ).resolves.toBeNull();
      const abs = new InMemorySessionStore(1000, 200);
      const old = makeSession('a', 'OLD', GEN_A, 'client-a', Date.now() - 250);
      await abs.set(old);
      await expect(abs.getIfGeneration(refFor(old))).resolves.toBeNull();
    });

    it('deterministic race: replacement between guard read and service read never returns the new cookie to the old generation', async () => {
      const old = makeSession('a', 'MoodleSession=OLD', GEN_A);
      const fresh = makeSession('a', 'MoodleSession=NEW', GEN_B);
      await store.set(old);
      await store.set(fresh);
      // Old-generation read must miss even though a live record exists.
      await expect(
        store.getIfGeneration({ sub: 'a', clientId: 'client-a', sessionGeneration: GEN_A }),
      ).resolves.toBeNull();
      // New-generation read hits the replacement.
      const hit = await store.getIfGeneration(refFor(fresh));
      expect(hit?.kulonCookie).toContain('MoodleSession=NEW');
    });
  });

  describe('replaceIfUnchanged (upstream-cookie renewal CAS)', () => {
    it('replaces only the SIAP cookie and retains the rest of the session', async () => {
      const expected = { ...makeSession('a', 'MoodleSession=OLD'), siapCookie: 'sia_app_session=old' };
      const replacement = { ...expected, siapCookie: 'sia_app_session=new' };
      await store.set(expected);
      await expect(store.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('updated');
      await expect(store.getIfGeneration(refFor(expected))).resolves.toEqual(replacement);
    });

    it('replaces only the SSO cookie while preserving every other field', async () => {
      const expected = {
        ...makeSession('a', 'MoodleSession=OLD'),
        ssoCookie: 'ci_session_sso=old',
        microsoftCookie: 'MS=keep',
        siapCookie: 'sia_app_session=keep',
        emailSso: 'student@example.test',
      };
      const replacement = { ...expected, ssoCookie: 'ci_session_sso=new' };
      await store.set(expected);

      await expect(store.replaceIfUnchanged(refFor(expected), expected, replacement)).resolves.toBe('updated');
      expect(await store.getIfGeneration(refFor(expected))).toEqual(replacement);
    });

    it('rejects an SSO renewal that also changes another field', async () => {
      const expected = { ...makeSession('a', 'MoodleSession=OLD'), ssoCookie: 'ci_session_sso=old' };
      await store.set(expected);

      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, {
          ...expected,
          ssoCookie: 'ci_session_sso=new',
          capturedAt: expected.capturedAt + 1,
        }),
      ).rejects.toThrow('Invalid session renewal replacement');
      await expect(store.getIfGeneration(refFor(expected))).resolves.toEqual(expected);
    });

    it('rejects an empty SSO renewal', async () => {
      const expected = { ...makeSession('a', 'MoodleSession=OLD'), ssoCookie: 'ci_session_sso=old' };
      await store.set(expected);

      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, { ...expected, ssoCookie: '' }),
      ).rejects.toThrow('Invalid session renewal replacement');
    });

    it('replaces only Kulon cookie and preserves identity, generation, capture time, and other session fields', async () => {
      const expected = {
        ...makeSession('a', 'MoodleSession=OLD'),
        microsoftCookie: 'MS=keep',
        siapCookie: 'sia_app_session=keep',
        emailSso: 'student@example.test',
      };
      const replacement = { ...expected, kulonCookie: 'MoodleSession=NEW' };
      await store.set(expected);

      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, replacement),
      ).resolves.toBe('updated');
      expect(await store.getIfGeneration(refFor(expected))).toEqual(replacement);
    });

    it('returns conflict and preserves the newer same-device snapshot', async () => {
      const expected = makeSession('a', 'MoodleSession=OLD');
      const newer = { ...expected, kulonCookie: 'MoodleSession=OTHER' };
      await store.set(expected);
      await store.set(newer);

      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, { ...expected, kulonCookie: 'MoodleSession=RENEWED' }),
      ).resolves.toBe('conflict');
      expect(await store.getIfGeneration(refFor(expected))).toEqual(newer);
    });

    it('returns dead for absent and absolute-expired records, conflict for a live generation mismatch', async () => {
      const expected = makeSession('a', 'MoodleSession=OLD');
      const replacement = { ...expected, kulonCookie: 'MoodleSession=NEW' };
      const absentRef: SessionRef = {
        sub: 'missing',
        clientId: 'client-a',
        sessionGeneration: GEN_A,
      };
      await expect(
        store.replaceIfUnchanged(
          absentRef,
          { ...expected, identity: 'missing' },
          { ...replacement, identity: 'missing' },
        ),
      ).resolves.toBe('dead');

      await store.set({ ...expected, sessionGeneration: GEN_B });
      await expect(
        store.replaceIfUnchanged(
          { sub: 'a', clientId: 'client-a', sessionGeneration: GEN_A },
          expected,
          replacement,
        ),
      ).resolves.toBe('conflict');
      await expect(
        store.getIfGeneration({ sub: 'a', clientId: 'client-a', sessionGeneration: GEN_B }),
      ).resolves.toMatchObject({ sessionGeneration: GEN_B });

      const absolute = new InMemorySessionStore(1000, 20);
      const expired = { ...expected, capturedAt: Date.now() - 30 };
      await absolute.set(expired);
      await expect(
        absolute.replaceIfUnchanged(refFor(expired), expired, { ...expired, kulonCookie: 'MoodleSession=NEW' }),
      ).resolves.toBe('dead');
      await expect(absolute.getIfGeneration(refFor(expired))).resolves.toBeNull();
    });

    it('rejects a replacement that changes a non-Kulon credential', async () => {
      const expected = makeSession('a', 'MoodleSession=OLD');
      await store.set(expected);
      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, expected),
      ).rejects.toThrow('Invalid session renewal replacement');
      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, {
          ...expected,
          kulonCookie: 'MoodleSession=NEW',
          siapCookie: 'sia_app_session=changed',
        }),
      ).rejects.toThrow('Invalid session renewal replacement');
      expect(await store.getIfGeneration(refFor(expected))).toEqual(expected);
    });

    it('rejects an empty renewed Kulon cookie', async () => {
      const expected = makeSession('a', 'MoodleSession=OLD');
      await store.set(expected);

      await expect(
        store.replaceIfUnchanged(refFor(expected), expected, { ...expected, kulonCookie: '' }),
      ).rejects.toThrow('Invalid session renewal replacement');
      expect(await store.getIfGeneration(refFor(expected))).toEqual(expected);
    });
  });

  it('migrateLegacyKeys is a no-op for the in-memory store', async () => {
    await expect(store.migrateLegacyKeys()).resolves.toEqual({ scanned: 0, migrated: 0 });
  });
});
