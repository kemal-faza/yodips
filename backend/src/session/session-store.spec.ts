import 'reflect-metadata';
import { SessionStore } from './session-store';

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

describe('SessionStore (per-user)', () => {
  let store: SessionStore;
  beforeEach(() => {
    store = new SessionStore();
  });

  it('stores and retrieves a session per identity', () => {
    store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    const s = store.get('24060121130000');
    expect(s?.kulonCookie).toContain('MoodleSession=A');
  });

  it('isolates different identities', () => {
    store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    store.set('24060121130001', makeSession('24060121130001', 'MoodleSession=B'));
    expect(store.get('24060121130000')?.kulonCookie).toContain('MoodleSession=A');
    expect(store.get('24060121130001')?.kulonCookie).toContain('MoodleSession=B');
  });

  it('returns null for an unknown identity', () => {
    expect(store.get('nobody')).toBeNull();
  });

  it('clears a single identity', () => {
    store.set('24060121130000', makeSession('24060121130000', 'MoodleSession=A'));
    store.set('24060121130001', makeSession('24060121130001', 'MoodleSession=B'));
    store.clear('24060121130000');
    expect(store.get('24060121130000')).toBeNull();
    expect(store.get('24060121130001')).not.toBeNull();
  });

  it('all() returns all stored sessions', () => {
    store.set('a', makeSession('a', 'A'));
    store.set('b', makeSession('b', 'B'));
    expect(store.all().map((s) => s.identity).sort()).toEqual(['a', 'b']);
  });
});