import 'reflect-metadata';
import { AuthService } from './auth.service';
import { LegacyAuthService } from './legacy-auth.service';
import { CachePolicy } from '../cache/cache-policy';
import type { TelemetryRuntime } from '../observability/telemetry';

// Mock-heavy spec: the session-store double and fetch helpers intentionally deal
// in arbitrary/dynamic `any` payloads, and several async helpers have no await.
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

const mockSsoTicket = {
  generateTicket: jest.fn(() => 'dGVzdA'),
  buildServiceUrl: jest.fn((service: string, t: string) =>
    service === 'siap'
      ? `https://siap.undip.ac.id/sso/login?t=${t}`
      : `https://kulon2.undip.ac.id/auth/oidc/?t=${t}`,
  ),
};
const mockPlaywright = {
  launchAndCaptureSession: jest.fn(),
  captureSession: jest.fn(),
};
const GEN_1 = 'a'.repeat(32);
const GEN_2 = 'b'.repeat(32);
const GEN_3 = 'c'.repeat(32);

const mockSessionStore = {
  _map: new Map<string, any>(),
  key(sub: string, clientId: string) {
    return `${sub}:${clientId}`;
  },
  set(s: any) {
    this._map.set(this.key(s.identity, s.clientId), s);
  },
  getIfGeneration(ref: any) {
    const rec = this._map.get(this.key(ref.sub, ref.clientId)) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return null;
    return rec;
  },
  replaceIfUnchanged(ref: any, expected: any, replacement: any) {
    const key = this.key(ref.sub, ref.clientId);
    const rec = this._map.get(key) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return 'dead';
    if (JSON.stringify(rec) !== JSON.stringify(expected)) return 'conflict';
    this._map.set(key, replacement);
    return 'updated';
  },
  clearIfGeneration(ref: any) {
    const key = this.key(ref.sub, ref.clientId);
    const rec = this._map.get(key);
    if (!rec) return true;
    if (rec.sessionGeneration !== ref.sessionGeneration) return false;
    this._map.delete(key);
    return true;
  },
  listBySub(sub: string) {
    return [...this._map.values()].filter((s) => s.identity === sub);
  },
  clearAllForSub(sub: string) {
    let n = 0;
    for (const [k, s] of this._map) {
      if (s.identity === sub) {
        this._map.delete(k);
        n++;
      }
    }
    return n;
  },
  all() {
    return [...this._map.values()];
  },
  migrateLegacyKeys() {
    return { scanned: 0, migrated: 0 };
  },
};

/** Seed one stored record under the composite `<sub>:<clientId>` key. */
function seedSession(identity: string, clientId: string, session: any): void {
  mockSessionStore._map.set(`${identity}:${clientId}`, {
    identity,
    clientId,
    ...session,
  });
}

/** Read one exact record through the full ref (mismatch → null). */
function readSession(identity: string, clientId: string): any {
  const rec = mockSessionStore._map.get(`${identity}:${clientId}`);
  if (!rec) return null;
  return mockSessionStore.getIfGeneration({
    sub: identity,
    clientId,
    sessionGeneration: rec.sessionGeneration,
  });
}

const mockJwt = {
  signAsync: jest.fn(async (p: any) => {
    void p;
    return 'jwt-token';
  }),
  verifyAsync: jest.fn(async (token: string, opts: any) => {
    if (token === 'expired-but-valid')
      return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: readSession('24060121130000', 'client-a')?.sessionGeneration ?? GEN_1 };
    if (token === 'logout-gen-1') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: GEN_1 };
    if (token === 'logout-gen-2') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: GEN_2 };
    if (token === 'logout-no-claim') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff' };
    if (token === 'logout-legacy-numeric') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: 111 };
    if (token === 'refresh-gen-1') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: GEN_1 };
    if (token === 'refresh-gen-2') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: GEN_2 };
    if (token === 'refresh-no-claim') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff' };
    if (token === 'refresh-legacy-numeric') return { sub: '24060121130000', clientId: 'client-a', via: 'handoff', sessionGeneration: 222 };
    if (token === 'refresh-bad-client') return { sub: '24060121130000', clientId: 'bad:id', via: 'handoff', sessionGeneration: GEN_1 };
    if (token === 'forged') throw new Error('invalid signature');
    throw new Error('unknown token');
  }),
};
const mockConfig = {
  get: jest.fn((k: string) => {
    const map: Record<string, string> = {
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      HANDOFF_KULON_RETRY_DELAY_MS: '1',
      CAPTURE_REUSE_ENABLED: 'true',
      SESSION_LEGACY_CLIENT_ENABLED: 'true',
      SESSION_MAX_PER_USER: '10',
    };
    return map[k];
  }),
};
const mockMicrosoftAuth = { getAuthUrl: jest.fn(), handleCallback: jest.fn() };
const mockKulon = {
  checkSessionValid: jest.fn(async () => ({
    valid: true,
    reason: 'ok',
  })),
  getSessionIdentity: jest.fn(
    async (): Promise<string | null> => '24060121130000',
  ),
};
const mockSiap = {
  checkSessionValid: jest.fn(async () => ({
    valid: true,
    reason: 'ok',
  })),
  fetchProfile: jest.fn(async () => ({
    emailSso: 'anonim.sso@students.undip.ac.id',
  })),
};

const clock = { wall: 1_700_000_000_000, monotonic: 0n };
const events: unknown[] = [];

function telemetryRuntime(): TelemetryRuntime {
  return {
    sink: { record: (event) => events.push(event) },
    wallNowMs: () => clock.wall,
    monotonicNowNs: () => {
      clock.monotonic += 1_000_000n;
      return clock.monotonic;
    },
  };
}

function makeService() {
  return new AuthService(
    mockSessionStore as any,
    mockJwt as any,
    mockConfig as any,
    mockKulon as any,
    mockSiap as any,
    telemetryRuntime(),
  );
}

function makeLegacyService() {
  return new LegacyAuthService(
    mockSsoTicket as any,
    mockMicrosoftAuth as any,
    mockPlaywright as any,
    mockSessionStore as any,
    mockJwt as any,
    mockConfig as any,
    mockKulon as any,
    mockSiap as any,
    telemetryRuntime(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStore._map.clear();
  clock.wall = 1_700_000_000_000;
  clock.monotonic = 0n;
  events.length = 0;
  global.fetch = jest.fn();
});

async function okFetch() {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: async () => '<input type="hidden" name="sesskey" value="abc">',
  });
}

describe('LegacyAuthService.captureSsoSession', () => {
  it('never reuses a legacy stored session without a valid generation (E)', async () => {
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      // no sessionGeneration (legacy)
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=FRESH',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();
    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('reuses a fresh valid session WITHOUT opening a browser window', async () => {
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    await okFetch();

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(true);
    expect(mockPlaywright.launchAndCaptureSession).not.toHaveBeenCalled();
  });

  it('never auto-reuses a stored session when CAPTURE_REUSE_ENABLED is off', async () => {
    // Default (flag absent): an unauthenticated /sso/capture caller must NOT be
    // handed another user's stored session+JWT (the HIGH #1 leak).
    const originalGet = mockConfig.get;
    const map: Record<string, string> = {
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      HANDOFF_KULON_RETRY_DELAY_MS: '1',
      // note: no CAPTURE_REUSE_ENABLED key
    };
    mockConfig.get = jest.fn((k: string) => map[k]);
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const fullCookies = {
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'cookiesession1=SIAP',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    };
    mockPlaywright.launchAndCaptureSession.mockResolvedValue(fullCookies);
    await okFetch();

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
    // restore default config for later tests
    mockConfig.get = originalGet;
  });

  it('opens interactive browser window when no stored session', async () => {
    const fullCookies = {
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'cookiesession1=SIAP',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    };
    mockPlaywright.launchAndCaptureSession.mockResolvedValue(fullCookies);

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(res.hasKulon).toBe(true);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalledWith(
      '/tmp/sso-chrome-profile',
      'https://sso.undip.ac.id/auth/user/login',
      'https://sso.undip.ac.id/pages/dashboard',
      'https://kulon2.undip.ac.id/auth/oidc/?t=dGVzdA',
      'https://siap.undip.ac.id/sso/login?t=dGVzdA',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(mockSessionStore._map.size).toBeGreaterThan(0);
  });

  it('opens interactive window when stored session probe fails (stale cookie)', async () => {
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=STALE',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    // Kulon probe fails (delegated to KulonService.checkSessionValid)
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=FRESH',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('opens interactive window when stored session is stale by TTL', async () => {
    // Deterministic against the injected wall clock: 31 min old > 30 min TTL.
    // The Kulon probe is live, so TTL alone must reject the stored session.
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: clock.wall - 31 * 60_000,
      sessionGeneration: GEN_1,
    });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('does not store an unverified Kulon session and reports hasKulon:false', async () => {
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=STALE',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.hasKulon).toBe(false);
    const stored = readSession('sso', 'legacy');
    expect(stored).not.toBeNull();
    expect(stored.kulonCookie).toBe('');
  });

  it('delegates the smart-reuse probe to KulonService.checkSessionValid', async () => {
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(true);
    expect(mockKulon.checkSessionValid).toHaveBeenCalledWith('MoodleSession=K');
  });

  it('does NOT reuse across users when multiple sessions exist (B3 - multi-user safety)', async () => {
    // Two different users have valid stored sessions.
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    seedSession('09060121130000', 'legacy', {
      identity: '09060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=FRESH',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    // Must NOT silently hand out a stored session belonging to another user —
    // open the interactive window instead.
    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('stores the captured session per-user with derived NIM identity', async () => {
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      identity: '',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');

    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();

    expect(res.hasKulon).toBe(true);
    expect(readSession('24060121130000', 'legacy')).not.toBeNull();
    expect(readSession('24060121130000', 'legacy').kulonCookie).toContain(
      'MoodleSession=K',
    );
  });

  it('reuse branch mints sessionGeneration from the reused record', async () => {
    const reusedAt = 1_700_000_000_123;
    const reusedGen = GEN_1;
    seedSession('24060121130000', 'legacy', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: reusedAt,
      sessionGeneration: reusedGen,
    });
    await okFetch();
    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'legacy',
      via: 'reuse',
      sessionGeneration: reusedGen,
    });
    expect(res.sessionGeneration).toBe(reusedGen);
  });

  it('interactive branch mints sessionGeneration from the freshly captured session', async () => {
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'cookiesession1=SIAP',
      capturedAt: clock.wall,
      sessionGeneration: GEN_3,
    });
    const svc = makeLegacyService();
    const res = await svc.captureSsoSession();
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'legacy',
      via: 'playwright',
      sessionGeneration: GEN_3,
    });
    expect(res.sessionGeneration).toBe(GEN_3);
  });
});

describe('AuthService.refresh', () => {
  it('mints a new JWT when signature is valid and the session is alive', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    // expired-but-valid echoes the live record generation
    mockJwt.verifyAsync.mockResolvedValueOnce({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const out = await svc.refresh('expired-but-valid');
    expect(out.accessToken).toBe('jwt-token');
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
  });

  it('preserves the via claim', async () => {
    mockJwt.verifyAsync.mockResolvedValueOnce({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'oidc',
      sessionGeneration: GEN_2,
    });
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      kulonCookie: 'K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_2,
    });
    const svc = makeService();
    await svc.refresh('expired-but-valid');
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'oidc',
      sessionGeneration: GEN_2,
    });
  });

  it('rejects a forged token with INVALID_TOKEN', async () => {
    const svc = makeService();
    await expect(svc.refresh('forged')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('returns SESSION_DEAD when the session store has no record', async () => {
    // mockSessionStore._map is empty
    const svc = makeService();
    await expect(svc.refresh('expired-but-valid')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('rejects a valid-signature token with NO sessionGeneration claim (legacy) with INVALID_TOKEN', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    await expect(svc.refresh('refresh-no-claim')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('rejects a numeric legacy generation with INVALID_TOKEN (shape, not SESSION_DEAD)', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      kulonCookie: 'K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_2,
    });
    const svc = makeService();
    await expect(svc.refresh('refresh-legacy-numeric')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(mockJwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a malformed supplied clientId claim with INVALID_TOKEN', async () => {
    const svc = makeService();
    await expect(svc.refresh('refresh-bad-client')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('does not refresh against another device live record', async () => {
    seedSession('24060121130000', 'client-b', {
      identity: '24060121130000',
      kulonCookie: 'MoodleSession=B',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    await expect(svc.refresh('refresh-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(mockJwt.signAsync).not.toHaveBeenCalled();
  });

  it('returns SESSION_DEAD when the live record is legacy (no generation)', async () => {
    mockJwt.verifyAsync.mockResolvedValueOnce({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      kulonCookie: 'K',
      siapCookie: '',
      capturedAt: Date.now(),
      // legacy: no sessionGeneration
    });
    const svc = makeService();
    await expect(svc.refresh('expired-but-valid')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('returns SESSION_DEAD when the live record is a NEWER generation than the token claim', async () => {
    // Old token minted at GEN_1; the user re-logged-in → live record GEN_2.
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_2,
    });
    const svc = makeService();
    await expect(svc.refresh('refresh-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(mockJwt.signAsync).not.toHaveBeenCalled();
  });

  it('mints with the CURRENT record generation when the claim matches', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_2,
    });
    const svc = makeService();
    const out = await svc.refresh('refresh-gen-2');
    expect(out.accessToken).toBe('jwt-token');
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'handoff',
      sessionGeneration: GEN_2,
    });
  });
});

describe('AuthService.handleSessionHandoff', () => {
  it('verifies, derives identity, stores per-user, and returns a JWT', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');

    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      ssoCookie: 'ci_session_sso=SSO',
    });

    expect(res.hasKulon).toBe(true);
    expect(res.capturedAt).toBe(clock.wall);
    expect(readSession('24060121130000', 'client-a')).not.toBeNull();
    expect(readSession('24060121130000', 'client-a').capturedAt).toBe(clock.wall);
    expect(readSession('24060121130000', 'client-a').kulonCookie).toContain(
      'MoodleSession=K',
    );
  });

  it('mints sessionGeneration from the stored generation (binds stored record)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
    });
    const storedGen = readSession('24060121130000', 'client-a').sessionGeneration;
    expect(storedGen).toMatch(/^[0-9a-f]{32}$/);
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'client-a',
      via: 'handoff',
      sessionGeneration: storedGen,
    });
    expect(res.capturedAt).toBe(clock.wall);
    expect(res.sessionGeneration).toBe(storedGen);
  });

  it('throws 401 with code KULON_STALE when the kulon cookie is stale', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ clientId: 'client-a', kulonCookie: 'MoodleSession=STALE' } as any),
    ).rejects.toMatchObject({
      response: {
        message: 'Session Kulon tidak valid. Silakan login ulang',
        code: 'KULON_STALE',
        reason: 'stale',
      },
    });
  });

  it('retries a transient KULON_STALE probe and succeeds once the session is live', async () => {
    mockKulon.checkSessionValid
      .mockResolvedValueOnce({ valid: false, reason: 'stale' }) // pre-auth/in-flight
      .mockResolvedValueOnce({ valid: true, reason: 'ok' }); // established on retry
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
    });
    expect(res.hasKulon).toBe(true);
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after the attempt cap and still throws KULON_STALE', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ clientId: 'client-a', kulonCookie: 'MoodleSession=STALE' } as any),
    ).rejects.toMatchObject({ response: { code: 'KULON_STALE' } });
    // initial probe + N retries = total attempts
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the probe fails as no-cookie (no point waiting)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'no-cookie',
    });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ clientId: 'client-a', kulonCookie: '' } as any),
    ).rejects.toMatchObject({ response: { code: 'KULON_NO_COOKIE' } });
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(1);
  });

  it('retries a transient SIAP stale probe and succeeds once the session is live', async () => {
    // Mirrors the Kulon retry: SIAP's `sia_app_session` cookie is also set before
    // its server-side session is fully established, so a single immediate probe
    // would reject a perfectly fresh login (the cascade-churn root cause).
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid
      .mockResolvedValueOnce({ valid: false, reason: 'stale' }) // pre-auth/in-flight
      .mockResolvedValueOnce({ valid: true, reason: 'ok' }); // established on retry
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'sia_app_session=SIAP',
    });
    expect(res.hasSiap).toBe(true);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledTimes(2);
  });

  it('throws 401 with code KULON_NO_COOKIE when no kulon cookie is provided', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'no-cookie',
    });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ clientId: 'client-a', kulonCookie: '' } as any),
    ).rejects.toMatchObject({
      response: { code: 'KULON_NO_COOKIE', reason: 'no-cookie' },
    });
  });

  it('throws 400 when identity cannot be derived and none is declared', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue(null);
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ clientId: 'client-a', kulonCookie: 'MoodleSession=K' } as any),
    ).rejects.toMatchObject({
      response: {
        message: 'Identitas tidak dapat ditentukan',
        code: 'IDENTITY_UNRESOLVED',
      },
    });
  });

  it('rejects a client-supplied identity when derivation fails (B4 - no spoofing)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue(null); // derivation fails
    const svc = makeService();
    // Even though the client declares a target identity, we must NOT trust it.
    await expect(
      svc.handleSessionHandoff({
        clientId: 'client-a',
        kulonCookie: 'MoodleSession=K',
        identity: '24060121130000',
      } as any),
    ).rejects.toMatchObject({
      response: { code: 'IDENTITY_UNRESOLVED' },
    });
    // No session is stored under the spoofed identity.
    expect(readSession('24060121130000', 'client-a')).toBeNull();
  });

  it('reports hasSiap based on SIAP session validity', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=K',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(false);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledWith('ci_session_x=K');
  });

  it('does NOT store a stale SIAP cookie (B5 - strip before store)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=STALE',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(false);
    const stored = readSession('24060121130000', 'client-a');
    expect(stored).not.toBeNull();
    // The stale SIAP cookie must be stripped, not persisted.
    expect(stored.siapCookie).toBe('');
  });

  it('stores a valid SIAP cookie after validation (B5)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(true);
    const stored = readSession('24060121130000', 'client-a');
    expect(stored.siapCookie).toBe('ci_session_x=VALID');
  });

  it('populates emailSso from the SIAP fetchProfile when the session is valid', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockSiap.fetchProfile.mockResolvedValue({ emailSso: 'anonim.sso@students.undip.ac.id' });
    const svc = makeService();
    await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    const stored = readSession('24060121130000', 'client-a');
    expect(stored.emailSso).toBe('anonim.sso@students.undip.ac.id');
    expect(mockSiap.fetchProfile).toHaveBeenCalledWith('ci_session_x=VALID');
  });

  it('tolerates a fetchProfile failure (never fails a Kulon-valid handoff)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockSiap.fetchProfile.mockRejectedValue(new Error('scrape boom'));
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      clientId: 'client-a',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(true);
    const stored = readSession('24060121130000', 'client-a');
    expect(stored.emailSso).toBeUndefined(); // omitted; resolveSiapIdentity will fallback-scrape
  });

  it('maps a missing clientId to the legacy client while the rollout flag is on', async () => {
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
    });
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      clientId: 'legacy',
      via: 'handoff',
      sessionGeneration: res.sessionGeneration,
    });
    expect(readSession('24060121130000', 'legacy')).toEqual(
      expect.objectContaining({ clientId: 'legacy' }),
    );
  });

  it.each(['legacy', 'bad:id', 'short'])(
    'rejects an explicitly supplied malformed clientId "%s" with INVALID_CLIENT_ID',
    async (clientId) => {
      const svc = makeService();
      await expect(
        svc.handleSessionHandoff({
          kulonCookie: 'MoodleSession=K',
          clientId,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_CLIENT_ID' },
      });
      expect(mockSessionStore._map.size).toBe(0);
    },
  );

  it('requires clientId when the legacy fallback is disabled', async () => {
    const originalGet = mockConfig.get;
    mockConfig.get = jest.fn((k: string) =>
      k === 'SESSION_LEGACY_CLIENT_ENABLED' ? 'false' : originalGet(k),
    );
    try {
      const svc = makeService();
      await expect(
        svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=K' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'CLIENT_ID_REQUIRED' },
      });
    } finally {
      mockConfig.get = originalGet;
    }
  });

  it('keeps another device session alive when one device re-logs in', async () => {
    const svc = makeService();
    const a = await svc.handleSessionHandoff({
      kulonCookie: 'K',
      siapCookie: 'S',
      ssoCookie: 'SSO',
      clientId: 'client-a',
    });
    const b = await svc.handleSessionHandoff({
      kulonCookie: 'K2',
      siapCookie: 'S2',
      ssoCookie: 'SSO2',
      clientId: 'client-b',
    });
    expect(mockSessionStore.listBySub('24060121130000')).toHaveLength(2);

    const a2 = await svc.handleSessionHandoff({
      kulonCookie: 'K3',
      siapCookie: 'S3',
      ssoCookie: 'SSO3',
      clientId: 'client-a',
    });
    expect(a2.sessionGeneration).not.toBe(a.sessionGeneration);
    expect(
      mockSessionStore.getIfGeneration({
        sub: '24060121130000',
        clientId: 'client-a',
        sessionGeneration: a.sessionGeneration,
      }),
    ).toBeNull();
    expect(
      mockSessionStore.getIfGeneration({
        sub: '24060121130000',
        clientId: 'client-b',
        sessionGeneration: b.sessionGeneration,
      }),
    ).toEqual(expect.objectContaining({ clientId: 'client-b' }));
  });

  it('evicts the oldest device when the cap is reached', async () => {
    const svc = makeService();
    for (let i = 0; i < 10; i++) {
      clock.wall += 1_000;
      await svc.handleSessionHandoff({
        kulonCookie: 'K',
        siapCookie: 'S',
        ssoCookie: 'SSO',
        clientId: `client-${i}`,
      });
    }
    clock.wall += 1_000;
    await svc.handleSessionHandoff({
      kulonCookie: 'K',
      siapCookie: 'S',
      ssoCookie: 'SSO',
      clientId: 'client-10',
    });
    const sessions = mockSessionStore.listBySub('24060121130000');
    expect(sessions).toHaveLength(10);
    expect(sessions.some((s) => s.clientId === 'client-0')).toBe(false);
  });
});

describe('LegacyAuthService.handleMicrosoftCallback', () => {
  it('stores the Microsoft session under a per-login key, not a shared literal (B10)', async () => {
    mockMicrosoftAuth.handleCallback.mockResolvedValue({
      accessToken: 'ms-at',
      sessionCookies: 'ESTSAUTH=MS',
    });
    // Capture the JWT payloads so we can assert distinct subs.
    mockJwt.signAsync.mockImplementation(async (p: any) => `jwt-${p.sub}`);
    const svc = makeLegacyService();
    const resA = await svc.handleMicrosoftCallback('codeA', 'stateA');
    const resB = await svc.handleMicrosoftCallback('codeB', 'stateB');

    // Two distinct login attempts must NOT overwrite each other's session.
    expect(mockSessionStore._map.size).toBe(2);
    expect(readSession('microsoft:stateA', 'legacy').capturedAt).toBe(clock.wall);
    expect(readSession('microsoft:stateB', 'legacy').capturedAt).toBe(clock.wall);
    const subs = [...mockSessionStore._map.keys()];
    expect(subs[0]).not.toBe(subs[1]);
    // The JWT sub for each resolves to its own stored session.
    expect(
      readSession(resA.accessToken.replace('jwt-', ''), 'legacy'),
    ).not.toBeNull();
    expect(
      readSession(resB.accessToken.replace('jwt-', ''), 'legacy'),
    ).not.toBeNull();
  });

  it('mints sessionGeneration from the per-login stored generation (binds stored record)', async () => {
    mockMicrosoftAuth.handleCallback.mockResolvedValue({
      accessToken: 'ms-at',
      sessionCookies: 'ESTSAUTH=MS',
    });
    const svc = makeLegacyService();
    await svc.handleMicrosoftCallback('codeX', 'stateX');
    const storedGen = readSession('microsoft:stateX', 'legacy').sessionGeneration;
    expect(storedGen).toMatch(/^[0-9a-f]{32}$/);
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: 'microsoft:stateX',
      clientId: 'legacy',
      via: 'oidc',
      sessionGeneration: storedGen,
    });
  });
});

describe('AuthService.me', () => {
  it('reports complete when the session has SSO, Kulon and SIAP cookies', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y',
      siapCookie: 'ci_session_x=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    expect(res.sub).toBe('24060121130000');
    expect(res.clientId).toBe('client-a');
    expect(res.authenticated).toBe(true);
    expect(res.hasSso).toBe(true);
    expect(res.hasMicrosoft).toBe(false);
    expect(res.hasKulon).toBe(true);
    expect(res.hasSiap).toBe(true);
    expect(res.complete).toBe(true);
  });

  it('reports complete false when a cookie is missing', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      siapCookie: 'ci_session_x=K', // no sso, no kulon
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    expect(res.hasSiap).toBe(true);
    expect(res.hasKulon).toBe(false);
    expect(res.complete).toBe(false);
  });

  it('reports unauthenticated + incomplete when no session exists', async () => {
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: 'unknown-user', sessionGeneration: GEN_1 });
    expect(res.clientId).toBe('client-a');
    expect(res.authenticated).toBe(false);
    expect(res.hasSso).toBe(false);
    expect(res.hasKulon).toBe(false);
    expect(res.hasSiap).toBe(false);
    expect(res.complete).toBe(false);
  });

  it('does not answer a token with another device live record', async () => {
    seedSession('24060121130000', 'client-b', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=b',
      siapCookie: 'siap=b',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    expect(res.clientId).toBe('client-a');
    expect(res.authenticated).toBe(false);
    expect(res.hasKulon).toBe(false);
    expect(mockKulon.checkSessionValid).not.toHaveBeenCalled();
  });

  it('live-probes Kulon validity instead of only checking cookie presence (B1)', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y', // present but STALE upstream
      siapCookie: 'ci_session_x=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    // Kulon probe fails (expired upstream), SIAP probe succeeds.
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: false,
      reason: 'stale',
    });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });

    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    expect(mockKulon.checkSessionValid).toHaveBeenCalledWith('kulon=y');
    expect(mockSiap.checkSessionValid).toHaveBeenCalledWith('ci_session_x=K');
    expect(res.hasKulon).toBe(false);
    expect(res.hasSiap).toBe(true);
    expect(res.complete).toBe(false);
  });

  it('caches live-probe results for ~60s to avoid probing on every call (B1)', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y',
      siapCookie: 'ci_session_x=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockKulon.checkSessionValid.mockResolvedValue({
      valid: true,
      reason: 'ok',
    });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });

    const svc = makeService();
    await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    await svc.me({ clientId: 'client-a', sub: '24060121130000', sessionGeneration: GEN_1 });
    // Probe should run once per service, cached for the subsequent calls.
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(1);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledTimes(1);
  });

  it('emits plain probe read events, writes the probe cache, and expires by wall time', async () => {
    seedSession('24060121130000', 'client-a', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y',
      siapCookie: 'ci_session_x=K',
      capturedAt: clock.wall,
      sessionGeneration: GEN_1,
    });
    const svc = makeService();

    await svc.me({ clientId: 'client-a', sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_1 });
    await svc.me({ clientId: 'client-a', sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_1 });

    expect(events.filter((event: any) => event.event === 'cache.read')).toEqual([
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'miss' }),
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'miss' }),
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'hit' }),
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'hit' }),
    ]);
    expect(JSON.stringify(events)).not.toContain('24060121130000');
    expect(JSON.stringify(events)).not.toContain('kulon=y');
    expect(JSON.stringify(events)).not.toContain('ci_session_x=K');

    clock.wall += CachePolicy.AUTH_PROBE;
    await svc.me({ clientId: 'client-a', sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_1 });

    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(2);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledTimes(2);
    expect(events.filter((event: any) => event.event === 'cache.read')).toEqual([
      expect.objectContaining({ outcome: 'miss' }),
      expect.objectContaining({ outcome: 'miss' }),
      expect.objectContaining({ outcome: 'hit' }),
      expect.objectContaining({ outcome: 'hit' }),
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'miss' }),
      expect.objectContaining({ cache: 'auth.probe', backend: 'memory', outcome: 'miss' }),
    ]);
  });

  // Sesi Android pairing tidak pernah punya ssoCookie (handoffBody tanpa ssoCookie).
  const PAIR_SESSION = {
    identity: 'NIMPAIR',
    ssoCookie: '',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=k',
    siapCookie: 'sia_app_session=s',
    capturedAt: Date.now(),
      sessionGeneration: GEN_1,
  };

  it('me(): via=pair menganggap complete walau ssoCookie kosong, bila Kulon+SIAP valid', async () => {
    seedSession('NIMPAIR', 'client-a', PAIR_SESSION);
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true });
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: 'NIMPAIR', via: 'pair', sessionGeneration: GEN_1 });
    expect(res.complete).toBe(true);
  });

  it('me(): token non-pair tetap mensyaratkan ssoCookie utk complete', async () => {
    seedSession('NIMPAIR2', 'client-a', { ...PAIR_SESSION, identity: 'NIMPAIR2' });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true });
    const svc = makeService();
    const res = await svc.me({ clientId: 'client-a', sub: 'NIMPAIR2', via: 'handoff', sessionGeneration: GEN_1 });
    expect(res.complete).toBe(false);
  });
});

describe('AuthService.logout', () => {
  const SEEDED = {
    identity: '24060121130000',
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=K',
    siapCookie: '',
    capturedAt: Date.now(),
    sessionGeneration: GEN_1,
  };

  it('clears the server session when the claim matches the live record generation', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).resolves.toEqual({ ok: true });
    expect(readSession('24060121130000', 'client-a')).toBeNull();
  });

  it('clears only the token device and leaves another device live', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED });
    seedSession('24060121130000', 'client-b', {
      ...SEEDED,
      sessionGeneration: GEN_2,
    });
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).resolves.toEqual({ ok: true });
    expect(readSession('24060121130000', 'client-a')).toBeNull();
    expect(readSession('24060121130000', 'client-b')).toEqual(
      expect.objectContaining({ clientId: 'client-b', sessionGeneration: GEN_2 }),
    );
  });

  it('is idempotent when the session is already gone (no record)', async () => {
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).resolves.toEqual({ ok: true });
  });

  it('does NOT clear a NEWER live record when the token claim is an OLDER generation (SESSION_DEAD)', async () => {
    // Re-login happened: live record GEN_2, token minted at GEN_1.
    seedSession('24060121130000', 'client-a', { ...SEEDED, sessionGeneration: GEN_2 });
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    // The newer session survives.
    expect(readSession('24060121130000', 'client-a')).not.toBeNull();
  });

  it('clears the live record when the token claim matches GEN_2', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED, sessionGeneration: GEN_2 });
    const svc = makeService();
    await expect(svc.logout('logout-gen-2')).resolves.toEqual({ ok: true });
    expect(readSession('24060121130000', 'client-a')).toBeNull();
  });

  it('rejects a forged token with INVALID_TOKEN and clears nothing', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('forged')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(readSession('24060121130000', 'client-a')).not.toBeNull();
  });

  it('rejects a validly-signed token with NO sessionGeneration claim (legacy) with INVALID_TOKEN and clears nothing', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-no-claim')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(readSession('24060121130000', 'client-a')).not.toBeNull();
  });

  it('rejects a numeric legacy generation with INVALID_TOKEN and clears nothing', async () => {
    seedSession('24060121130000', 'client-a', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-legacy-numeric')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(readSession('24060121130000', 'client-a')).not.toBeNull();
  });

  it('CAS lost to a newer record between read and clear preserves the newer session (deterministic race)', async () => {
    // Seed GEN_1, then simulate a re-login overwriting with GEN_2 before the
    // atomic clear runs: logout(GEN_1) must fail without deleting GEN_2.
    seedSession('24060121130000', 'client-a', { ...SEEDED, sessionGeneration: GEN_1 });
    const svc = makeService();
    // Interleave: replacement lands first.
    seedSession('24060121130000', 'client-a', { ...SEEDED, sessionGeneration: GEN_2, kulonCookie: 'MoodleSession=NEW' });
    await expect(svc.logout('logout-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(readSession('24060121130000', 'client-a')?.kulonCookie).toContain('MoodleSession=NEW');
    // Current generation still logs out cleanly.
    await expect(svc.logout('logout-gen-2')).resolves.toEqual({ ok: true });
    expect(readSession('24060121130000', 'client-a')).toBeNull();
  });
});
