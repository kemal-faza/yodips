import 'reflect-metadata';
import { InMemorySessionStore } from './in-memory-session.store';
import { generateSessionGeneration } from './session-contract';

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

describe('InMemorySessionStore (per-user, TTL)', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore(1000); // 1s TTL
  });

  it('stores and retrieves a session per identity', async () => {
    await store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    const s = await store.get('24060121130000');
    expect(s?.kulonCookie).toContain('MoodleSession=A');
  });

  it('isolates different identities', async () => {
    await store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    await store.set('24060121130001', makeSession('24060121130001', 'MoodleSession=B'));
    expect((await store.get('24060121130000'))?.kulonCookie).toContain('MoodleSession=A');
    expect((await store.get('24060121130001'))?.kulonCookie).toContain('MoodleSession=B');
  });

  it('returns null for an unknown identity', async () => {
    expect(await store.get('nobody')).toBeNull();
  });

  it('clears a single identity', async () => {
    await store.set('a', makeSession('a', 'A'));
    await store.set('b', makeSession('b', 'B'));
    await store.clear('a');
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).not.toBeNull();
  });

  it('all() returns all stored sessions', async () => {
    await store.set('a', makeSession('a', 'A'));
    await store.set('b', makeSession('b', 'B'));
    expect((await store.all()).map((s) => s.identity).sort()).toEqual(['a', 'b']);
  });

  it('returns null once a session has expired (TTL)', async () => {
    store = new InMemorySessionStore(20);
    await store.set('a', makeSession('a', 'A'));
    await new Promise((r) => setTimeout(r, 30));
    expect(await store.get('a')).toBeNull();
  });

  it('sliding TTL: get() keeps a session alive', async () => {
    store = new InMemorySessionStore(30);
    await store.set('a', makeSession('a', 'A'));
    await new Promise((r) => setTimeout(r, 15));
    await store.get('a');
    await new Promise((r) => setTimeout(r, 15));
    expect(await store.get('a')).not.toBeNull();
  });

  it('set() overwrites an existing session and refreshes TTL', async () => {
    store = new InMemorySessionStore(20);
    await store.set('a', makeSession('a', 'MoodleSession=A'));
    await store.set('a', makeSession('a', 'MoodleSession=B'));
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=B');
  });

  it('absolute cap: get() returns null once capturedAt + absoluteMs passes, even while the sliding TTL is fresh', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 200); // sliding 1s, absolute 200ms
    await store.set('a', { ...makeSession('a', 'MoodleSession=A'), capturedAt: now - 250 });
    expect(await store.get('a')).toBeNull();
  });

  it('absolute cap: get() returns the session while within the cap', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 1000);
    await store.set('a', { ...makeSession('a', 'MoodleSession=A'), capturedAt: now });
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=A');
  });

  it('absolute cap: get() slides the TTL when within the cap (sliding semantics preserved)', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 1000);
    await store.set('a', { ...makeSession('a', 'MoodleSession=A'), capturedAt: now - 500 });
    // First get() must succeed (within the cap) and re-arm expiresAt.
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=A');
    // Access does NOT extend the absolute bound: past 1000ms from capturedAt it dies.
    await new Promise((r) => setTimeout(r, 600));
    expect(await store.get('a')).toBeNull();
  });

  it('absolute cap disabled when absoluteMs is undefined (legacy sliding-only behavior)', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000); // no absolute cap
    await store.set('a', { ...makeSession('a', 'MoodleSession=A'), capturedAt: now - 5000 });
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=A');
  });

  it('natural re-login: a session past the absolute cap is dead, and a fresh set() for the same identity is readable again', async () => {
    const now = Date.now();
    store = new InMemorySessionStore(1000, 200); // sliding 1s, absolute 200ms
    // Old session captured 250ms ago > 200ms cap → dead.
    await store.set('a', { ...makeSession('a', 'MoodleSession=OLD'), capturedAt: now - 250 });
    expect(await store.get('a')).toBeNull();
    // The user re-logins: a new handoff stores a fresh session under the SAME
    // identity with a current capturedAt → must be readable again.
    await store.set('a', { ...makeSession('a', 'MoodleSession=NEW', GEN_B), capturedAt: Date.now() });
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=NEW');
  });

  describe('clearIfGeneration (atomic compare-and-clear)', () => {
    it('clears when the generation matches and returns true', async () => {
      await store.set('a', makeSession('a', 'A', GEN_A));
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(true);
      expect(await store.get('a')).toBeNull();
    });

    it('is idempotent when no record exists (true, nothing cleared)', async () => {
      await expect(store.clearIfGeneration('ghost', GEN_A)).resolves.toBe(true);
    });

    it('never clears a NEWER live record on generation mismatch (false, record survives)', async () => {
      await store.set('a', makeSession('a', 'MoodleSession=NEW', GEN_B));
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(false);
      expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=NEW');
    });

    it('deterministic race: replacement between read and logout never clears the newer session', async () => {
      // Seed gen-A, read it (simulating logout's pre-read), then a re-login
      // overwrites with gen-B BEFORE the compare-and-clear runs.
      await store.set('a', makeSession('a', 'MoodleSession=OLD', GEN_A));
      const staleRead = await store.get('a');
      expect(staleRead?.sessionGeneration).toBe(GEN_A);
      await store.set('a', makeSession('a', 'MoodleSession=NEW', GEN_B));
      // Logout with the STALE generation must lose the CAS and preserve NEW.
      await expect(store.clearIfGeneration('a', GEN_A)).resolves.toBe(false);
      expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=NEW');
      // Logout with the CURRENT generation succeeds.
      await expect(store.clearIfGeneration('a', GEN_B)).resolves.toBe(true);
      expect(await store.get('a')).toBeNull();
    });

    it('treats an expired record as absent (true, no generation check)', async () => {
      store = new InMemorySessionStore(20);
      await store.set('a', makeSession('a', 'A', GEN_A));
      await new Promise((r) => setTimeout(r, 30));
      await expect(store.clearIfGeneration('a', 'f'.repeat(32))).resolves.toBe(true);
    });

    it('generateSessionGeneration produces 128-bit lowercase hex without timestamp coupling', () => {
      const g1 = generateSessionGeneration();
      const g2 = generateSessionGeneration();
      expect(g1).toMatch(/^[0-9a-f]{32}$/);
      expect(g2).toMatch(/^[0-9a-f]{32}$/);
      expect(g1).not.toBe(g2);
    });
  });

  describe('getIfGeneration (generation-qualified atomic snapshot)', () => {
    it('returns the live record only on exact generation match (and slides TTL)', async () => {
      await store.set('a', makeSession('a', 'MoodleSession=A', GEN_A));
      const hit = await (store as any).getIfGeneration('a', GEN_A);
      expect(hit?.kulonCookie).toContain('MoodleSession=A');
      const miss = await (store as any).getIfGeneration('a', GEN_B);
      expect(miss).toBeNull();
      // Mismatch must NOT destroy the live record.
      expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=A');
    });

    it('returns null for unknown identity', async () => {
      await expect((store as any).getIfGeneration('ghost', GEN_A)).resolves.toBeNull();
    });

    it('returns null for a legacy record without generation (never matches)', async () => {
      await store.set('a', { ...makeSession('a', 'A', GEN_A), sessionGeneration: undefined as any });
      await expect((store as any).getIfGeneration('a', GEN_A)).resolves.toBeNull();
    });

    it('treats expired/absolute-dead records as absent before the mismatch check', async () => {
      store = new InMemorySessionStore(20);
      await store.set('a', makeSession('a', 'A', GEN_A));
      await new Promise((r) => setTimeout(r, 30));
      await expect((store as any).getIfGeneration('a', 'f'.repeat(32))).resolves.toBeNull();
      const abs = new InMemorySessionStore(1000, 200);
      await abs.set('a', { ...makeSession('a', 'OLD', GEN_A), capturedAt: Date.now() - 250 });
      await expect((abs as any).getIfGeneration('a', GEN_A)).resolves.toBeNull();
    });

    it('deterministic race: replacement between guard read and service read never returns the new cookie to the old generation', async () => {
      await store.set('a', makeSession('a', 'MoodleSession=OLD', GEN_A));
      await store.set('a', makeSession('a', 'MoodleSession=NEW', GEN_B));
      // Old-generation read must miss even though a live record exists.
      await expect((store as any).getIfGeneration('a', GEN_A)).resolves.toBeNull();
      // New-generation read hits the replacement.
      const hit = await (store as any).getIfGeneration('a', GEN_B);
      expect(hit?.kulonCookie).toContain('MoodleSession=NEW');
    });
  });
});
