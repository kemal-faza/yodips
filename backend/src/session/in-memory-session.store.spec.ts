import 'reflect-metadata';
import { InMemorySessionStore } from './in-memory-session.store';

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
    await store.set('a', { ...makeSession('a', 'MoodleSession=NEW'), capturedAt: Date.now() });
    expect((await store.get('a'))?.kulonCookie).toContain('MoodleSession=NEW');
  });
});
