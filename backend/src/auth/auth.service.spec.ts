import 'reflect-metadata';
import { AuthService } from './auth.service';
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
  set(identity: string, s: any) {
    this._map.set(identity, s);
  },
  get(identity: string) {
    return this._map.get(identity) ?? null;
  },
  getIfGeneration(identity: string, generation: string) {
    const rec = this._map.get(identity) ?? null;
    if (!rec || rec.sessionGeneration !== generation) return null;
    return rec;
  },
  clear(identity: string) {
    this._map.delete(identity);
  },
  clearIfGeneration(identity: string, generation: string) {
    const rec = this._map.get(identity);
    if (!rec) return true;
    if (rec.sessionGeneration !== generation) return false;
    this._map.delete(identity);
    return true;
  },
  all() {
    return [...this._map.values()];
  },
};
const mockJwt = {
  signAsync: jest.fn(async (p: any) => {
    void p;
    return 'jwt-token';
  }),
  verifyAsync: jest.fn(async (token: string, opts: any) => {
    if (token === 'expired-but-valid')
      return { sub: '24060121130000', via: 'handoff', sessionGeneration: mockSessionStore.get('24060121130000')?.sessionGeneration ?? GEN_1 };
    if (token === 'logout-gen-1') return { sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_1 };
    if (token === 'logout-gen-2') return { sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_2 };
    if (token === 'logout-no-claim') return { sub: '24060121130000', via: 'handoff' };
    if (token === 'logout-legacy-numeric') return { sub: '24060121130000', via: 'handoff', sessionGeneration: 111 };
    if (token === 'refresh-gen-1') return { sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_1 };
    if (token === 'refresh-gen-2') return { sub: '24060121130000', via: 'handoff', sessionGeneration: GEN_2 };
    if (token === 'refresh-no-claim') return { sub: '24060121130000', via: 'handoff' };
    if (token === 'refresh-legacy-numeric') return { sub: '24060121130000', via: 'handoff', sessionGeneration: 222 };
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
    };
    return map[k];
  }),
};
const mockSsoAuth = { login: jest.fn() };
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
    mockSsoAuth as any,
    mockSsoTicket,
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

describe('AuthService.login clock', () => {
  it('stores the injected wall-clock capturedAt plus a fresh crypto generation', async () => {
    mockSsoAuth.login.mockResolvedValue({ cookie: 'ci_session_sso=sso', redirectUrl: '/dashboard' });
    const svc = makeService();

    const result = await svc.login('identity', 'password');

    expect(result).toMatchObject({ accessToken: 'jwt-token', redirectUrl: '/dashboard' });
    expect(mockSessionStore.get('identity').capturedAt).toBe(clock.wall);
    expect(mockSessionStore.get('identity').sessionGeneration).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints a JWT whose sessionGeneration equals the freshly stored generation (not capturedAt)', async () => {
    mockSsoAuth.login.mockResolvedValue({ cookie: 'ci_session_sso=sso', redirectUrl: '/dashboard' });
    const svc = makeService();
    await svc.login('identity', 'password');
    const storedGen = mockSessionStore.get('identity').sessionGeneration;
    expect(storedGen).toMatch(/^[0-9a-f]{32}$/);
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: 'identity',
      via: 'sso',
      sessionGeneration: storedGen,
    });
  });

  it('mints distinct generations for successive logins (no timestamp collision)', async () => {
    mockSsoAuth.login.mockResolvedValue({ cookie: 'ci_session_sso=sso', redirectUrl: '/dashboard' });
    const svc = makeService();
    await svc.login('u1', 'p');
    await svc.login('u2', 'p');
    const g1 = mockSessionStore.get('u1').sessionGeneration;
    const g2 = mockSessionStore.get('u2').sessionGeneration;
    expect(g1).toMatch(/^[0-9a-f]{32}$/);
    expect(g2).toMatch(/^[0-9a-f]{32}$/);
    expect(g1).not.toBe(g2);
  });

  it('uses the injected wall clock for freshness and expires at the TTL boundary', () => {
    const svc = makeService();
    const session = { capturedAt: clock.wall - CachePolicy.AUTH_PROBE };

    expect((svc as any).isFresh(session)).toBe(true);
    clock.wall += 30 * 60_000;
    expect((svc as any).isFresh(session)).toBe(false);
  });
});

describe('AuthService.captureSsoSession', () => {
  it('never reuses a legacy stored session without a valid generation (E)', async () => {
    mockSessionStore._map.set('24060121130000', {
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
    const svc = makeService();
    const res = await svc.captureSsoSession();
    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('reuses a fresh valid session WITHOUT opening a browser window', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    await okFetch();

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(true);
    expect(mockPlaywright.launchAndCaptureSession).not.toHaveBeenCalled();
  });

  it('never auto-reuses a stored session when CAPTURE_REUSE_ENABLED is off', async () => {
    // Default (flag absent): an unauthenticated /sso/capture caller must NOT be
    // handed another user's stored session+JWT (the HIGH #1 leak).
    const map: Record<string, string> = {
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      HANDOFF_KULON_RETRY_DELAY_MS: '1',
      // note: no CAPTURE_REUSE_ENABLED key
    };
    mockConfig.get = jest.fn((k: string) => map[k]);
    mockSessionStore._map.set('24060121130000', {
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

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
    // restore default config for later tests
    mockConfig.get = jest.fn((k: string) => {
      const map2: Record<string, string> = {
        SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
        SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
        CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
        HANDOFF_KULON_RETRY_DELAY_MS: '1',
        CAPTURE_REUSE_ENABLED: 'true',
      };
      return map2[k];
    });
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

    const svc = makeService();
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
    mockSessionStore._map.set('24060121130000', {
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

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(false);
    expect(mockPlaywright.launchAndCaptureSession).toHaveBeenCalled();
  });

  it('opens interactive window when stored session is stale by TTL', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now() - 60 * 60 * 1000, // 1h old
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

    const svc = makeService();
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

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.hasKulon).toBe(false);
    const stored = mockSessionStore.get('sso');
    expect(stored).not.toBeNull();
    expect(stored.kulonCookie).toBe('');
  });

  it('delegates the smart-reuse probe to KulonService.checkSessionValid', async () => {
    mockSessionStore._map.set('24060121130000', {
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

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(true);
    expect(mockKulon.checkSessionValid).toHaveBeenCalledWith('MoodleSession=K');
  });

  it('does NOT reuse across users when multiple sessions exist (B3 - multi-user safety)', async () => {
    // Two different users have valid stored sessions.
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    mockSessionStore._map.set('09060121130011', {
      identity: '09060121130011',
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

    const svc = makeService();
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

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.hasKulon).toBe(true);
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
    expect(mockSessionStore.get('24060121130000').kulonCookie).toContain(
      'MoodleSession=K',
    );
  });

  it('reuse branch mints sessionGeneration from the reused record', async () => {
    const reusedAt = 1_700_000_000_123;
    const reusedGen = GEN_1;
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: reusedAt,
      sessionGeneration: reusedGen,
    });
    await okFetch();
    const svc = makeService();
    const res = await svc.captureSsoSession();
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
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
    const svc = makeService();
    const res = await svc.captureSsoSession();
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      via: 'playwright',
      sessionGeneration: GEN_3,
    });
    expect(res.sessionGeneration).toBe(GEN_3);
  });
});

describe('AuthService.refresh', () => {
  it('mints a new JWT when signature is valid and the session is alive', async () => {
    mockSessionStore._map.set('24060121130000', {
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
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const out = await svc.refresh('expired-but-valid');
    expect(out.accessToken).toBe('jwt-token');
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
  });

  it('preserves the via claim', async () => {
    mockJwt.verifyAsync.mockResolvedValueOnce({
      sub: '24060121130000',
      via: 'oidc',
      sessionGeneration: GEN_2,
    });
    mockSessionStore._map.set('24060121130000', {
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
    mockSessionStore._map.set('24060121130000', {
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
    mockSessionStore._map.set('24060121130000', {
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

  it('returns SESSION_DEAD when the live record is legacy (no generation)', async () => {
    mockJwt.verifyAsync.mockResolvedValueOnce({
      sub: '24060121130000',
      via: 'handoff',
      sessionGeneration: GEN_1,
    });
    mockSessionStore._map.set('24060121130000', {
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
    mockSessionStore._map.set('24060121130000', {
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
    mockSessionStore._map.set('24060121130000', {
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
      kulonCookie: 'MoodleSession=K',
      ssoCookie: 'ci_session_sso=SSO',
    });

    expect(res.hasKulon).toBe(true);
    expect(res.capturedAt).toBe(clock.wall);
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
    expect(mockSessionStore.get('24060121130000').capturedAt).toBe(clock.wall);
    expect(mockSessionStore.get('24060121130000').kulonCookie).toContain(
      'MoodleSession=K',
    );
  });

  it('mints sessionGeneration from the stored generation (binds stored record)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
    });
    const storedGen = mockSessionStore.get('24060121130000').sessionGeneration;
    expect(storedGen).toMatch(/^[0-9a-f]{32}$/);
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: '24060121130000',
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
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=STALE' } as any),
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
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=STALE' } as any),
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
      svc.handleSessionHandoff({ kulonCookie: '' } as any),
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
      svc.handleSessionHandoff({ kulonCookie: '' } as any),
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
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=K' } as any),
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
        kulonCookie: 'MoodleSession=K',
        identity: '24060121130000',
      } as any),
    ).rejects.toMatchObject({
      response: { code: 'IDENTITY_UNRESOLVED' },
    });
    // No session is stored under the spoofed identity.
    expect(mockSessionStore.get('24060121130000')).toBeNull();
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
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=STALE',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(false);
    const stored = mockSessionStore.get('24060121130000');
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
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(true);
    const stored = mockSessionStore.get('24060121130000');
    expect(stored.siapCookie).toBe('ci_session_x=VALID');
  });

  it('populates emailSso from the SIAP fetchProfile when the session is valid', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockSiap.fetchProfile.mockResolvedValue({ emailSso: 'anonim.sso@students.undip.ac.id' });
    const svc = makeService();
    await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    const stored = mockSessionStore.get('24060121130000');
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
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    });
    expect(res.hasSiap).toBe(true);
    const stored = mockSessionStore.get('24060121130000');
    expect(stored.emailSso).toBeUndefined(); // omitted; resolveSiapIdentity will fallback-scrape
  });
});

describe('AuthService.handleMicrosoftCallback', () => {
  it('stores the Microsoft session under a per-login key, not a shared literal (B10)', async () => {
    mockMicrosoftAuth.handleCallback.mockResolvedValue({
      accessToken: 'ms-at',
      sessionCookies: 'ESTSAUTH=MS',
    });
    // Capture the JWT payloads so we can assert distinct subs.
    mockJwt.signAsync.mockImplementation(async (p: any) => `jwt-${p.sub}`);
    const svc = makeService();
    const resA = await svc.handleMicrosoftCallback('codeA', 'stateA');
    const resB = await svc.handleMicrosoftCallback('codeB', 'stateB');

    // Two distinct login attempts must NOT overwrite each other's session.
    expect(mockSessionStore._map.size).toBe(2);
    expect(mockSessionStore.get('microsoft:stateA').capturedAt).toBe(clock.wall);
    expect(mockSessionStore.get('microsoft:stateB').capturedAt).toBe(clock.wall);
    const subs = [...mockSessionStore._map.keys()];
    expect(subs[0]).not.toBe(subs[1]);
    // The JWT sub for each resolves to its own stored session.
    expect(
      mockSessionStore.get(resA.accessToken.replace('jwt-', '')),
    ).not.toBeNull();
    expect(
      mockSessionStore.get(resB.accessToken.replace('jwt-', '')),
    ).not.toBeNull();
  });

  it('mints sessionGeneration from the per-login stored generation (binds stored record)', async () => {
    mockMicrosoftAuth.handleCallback.mockResolvedValue({
      accessToken: 'ms-at',
      sessionCookies: 'ESTSAUTH=MS',
    });
    const svc = makeService();
    await svc.handleMicrosoftCallback('codeX', 'stateX');
    const storedGen = mockSessionStore.get('microsoft:stateX').sessionGeneration;
    expect(storedGen).toMatch(/^[0-9a-f]{32}$/);
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: 'microsoft:stateX',
      via: 'oidc',
      sessionGeneration: storedGen,
    });
  });
});

describe('AuthService.me', () => {
  it('reports complete when the session has SSO, Kulon and SIAP cookies', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y',
      siapCookie: 'ci_session_x=K',
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const res = await svc.me({ sub: '24060121130000' });
    expect(res.sub).toBe('24060121130000');
    expect(res.authenticated).toBe(true);
    expect(res.hasSso).toBe(true);
    expect(res.hasMicrosoft).toBe(false);
    expect(res.hasKulon).toBe(true);
    expect(res.hasSiap).toBe(true);
    expect(res.complete).toBe(true);
  });

  it('reports complete false when a cookie is missing', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      siapCookie: 'ci_session_x=K', // no sso, no kulon
      capturedAt: Date.now(),
      sessionGeneration: GEN_1,
    });
    const svc = makeService();
    const res = await svc.me({ sub: '24060121130000' });
    expect(res.hasSiap).toBe(true);
    expect(res.hasKulon).toBe(false);
    expect(res.complete).toBe(false);
  });

  it('reports unauthenticated + incomplete when no session exists', async () => {
    const svc = makeService();
    const res = await svc.me({ sub: 'unknown-user' });
    expect(res.authenticated).toBe(false);
    expect(res.hasSso).toBe(false);
    expect(res.hasKulon).toBe(false);
    expect(res.hasSiap).toBe(false);
    expect(res.complete).toBe(false);
  });

  it('live-probes Kulon validity instead of only checking cookie presence (B1)', async () => {
    mockSessionStore._map.set('24060121130000', {
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
    const res = await svc.me({ sub: '24060121130000' });
    expect(mockKulon.checkSessionValid).toHaveBeenCalledWith('kulon=y');
    expect(mockSiap.checkSessionValid).toHaveBeenCalledWith('ci_session_x=K');
    expect(res.hasKulon).toBe(false);
    expect(res.hasSiap).toBe(true);
    expect(res.complete).toBe(false);
  });

  it('caches live-probe results for ~60s to avoid probing on every call (B1)', async () => {
    mockSessionStore._map.set('24060121130000', {
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
    await svc.me({ sub: '24060121130000' });
    await svc.me({ sub: '24060121130000' });
    await svc.me({ sub: '24060121130000' });
    // Probe should run once per service, cached for the subsequent calls.
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(1);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledTimes(1);
  });

  it('emits plain probe read events, writes the probe cache, and expires by wall time', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'sso=x',
      microsoftCookie: '',
      kulonCookie: 'kulon=y',
      siapCookie: 'ci_session_x=K',
      capturedAt: clock.wall,
      sessionGeneration: GEN_1,
    });
    const svc = makeService();

    await svc.me({ sub: '24060121130000', via: 'handoff' });
    await svc.me({ sub: '24060121130000', via: 'handoff' });

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
    await svc.me({ sub: '24060121130000', via: 'handoff' });

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

  it('AUTH_PROBE TTL matches the probe cache window', () => {
    expect(CachePolicy.AUTH_PROBE).toBe(60_000);
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
    mockSessionStore._map.set('NIMPAIR', PAIR_SESSION);
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true });
    const svc = makeService();
    const res = await svc.me({ sub: 'NIMPAIR', via: 'pair' });
    expect(res.complete).toBe(true);
  });

  it('me(): token non-pair tetap mensyaratkan ssoCookie utk complete', async () => {
    mockSessionStore._map.set('NIMPAIR2', { ...PAIR_SESSION, identity: 'NIMPAIR2' });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true });
    const svc = makeService();
    const res = await svc.me({ sub: 'NIMPAIR2', via: 'handoff' });
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
    mockSessionStore._map.set('24060121130000', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).resolves.toEqual({ ok: true });
    expect(mockSessionStore.get('24060121130000')).toBeNull();
  });

  it('is idempotent when the session is already gone (no record)', async () => {
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).resolves.toEqual({ ok: true });
  });

  it('does NOT clear a NEWER live record when the token claim is an OLDER generation (SESSION_DEAD)', async () => {
    // Re-login happened: live record GEN_2, token minted at GEN_1.
    mockSessionStore._map.set('24060121130000', { ...SEEDED, sessionGeneration: GEN_2 });
    const svc = makeService();
    await expect(svc.logout('logout-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    // The newer session survives.
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
  });

  it('clears the live record when the token claim matches GEN_2', async () => {
    mockSessionStore._map.set('24060121130000', { ...SEEDED, sessionGeneration: GEN_2 });
    const svc = makeService();
    await expect(svc.logout('logout-gen-2')).resolves.toEqual({ ok: true });
    expect(mockSessionStore.get('24060121130000')).toBeNull();
  });

  it('rejects a forged token with INVALID_TOKEN and clears nothing', async () => {
    mockSessionStore._map.set('24060121130000', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('forged')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
  });

  it('rejects a validly-signed token with NO sessionGeneration claim (legacy) with INVALID_TOKEN and clears nothing', async () => {
    mockSessionStore._map.set('24060121130000', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-no-claim')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
  });

  it('rejects a numeric legacy generation with INVALID_TOKEN and clears nothing', async () => {
    mockSessionStore._map.set('24060121130000', { ...SEEDED });
    const svc = makeService();
    await expect(svc.logout('logout-legacy-numeric')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
  });

  it('CAS lost to a newer record between read and clear preserves the newer session (deterministic race)', async () => {
    // Seed GEN_1, then simulate a re-login overwriting with GEN_2 before the
    // atomic clear runs: logout(GEN_1) must fail without deleting GEN_2.
    mockSessionStore._map.set('24060121130000', { ...SEEDED, sessionGeneration: GEN_1 });
    const svc = makeService();
    // Interleave: replacement lands first.
    mockSessionStore._map.set('24060121130000', { ...SEEDED, sessionGeneration: GEN_2, kulonCookie: 'MoodleSession=NEW' });
    await expect(svc.logout('logout-gen-1')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(mockSessionStore.get('24060121130000')?.kulonCookie).toContain('MoodleSession=NEW');
    // Current generation still logs out cleanly.
    await expect(svc.logout('logout-gen-2')).resolves.toEqual({ ok: true });
    expect(mockSessionStore.get('24060121130000')).toBeNull();
  });
});
