import 'reflect-metadata';
import { AuthService } from './auth.service';
import { SSOTicketService } from '../sso/ticket.service';
import { SessionStore } from '../session/session-store';

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
const mockSessionStore = {
  _map: new Map<string, any>(),
  set(identity: string, s: any) { this._map.set(identity, s); },
  get(identity: string) { return this._map.get(identity) ?? null; },
  clear(identity: string) { this._map.delete(identity); },
  all() { return [...this._map.values()]; },
};
const mockJwt = { signAsync: jest.fn(async () => 'jwt-token') };
const mockConfig = {
  get: jest.fn((k: string) => {
    const map: Record<string, string> = {
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      HANDOFF_KULON_RETRY_DELAY_MS: '1',
    };
    return map[k];
  }),
};
const mockSsoAuth = { login: jest.fn() };
const mockMicrosoftAuth = { getAuthUrl: jest.fn(), handleCallback: jest.fn() };
const mockKulon = {
  checkSessionValid: jest.fn(async () => ({ valid: true, reason: 'ok' as const })),
  getSessionIdentity: jest.fn(async () => '24060121130000'),
};
const mockSiap = {
  checkSessionValid: jest.fn(async () => ({ valid: true, reason: 'ok' as const })),
};

function makeService() {
  return new AuthService(
    mockSsoAuth as any,
    mockSsoTicket as any,
    mockMicrosoftAuth as any,
    mockPlaywright as any,
    mockSessionStore as any,
    mockJwt as any,
    mockConfig as any,
    mockKulon as any,
    mockSiap as any,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStore._map.clear();
  global.fetch = jest.fn();
});

async function okFetch() {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: async () => '<input type="hidden" name="sesskey" value="abc">',
  });
}

describe('AuthService.captureSsoSession', () => {
  it('reuses a fresh valid session WITHOUT opening a browser window', async () => {
    mockSessionStore._map.set('24060121130000', {
      identity: '24060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
    });
    await okFetch();

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.reused).toBe(true);
    expect(mockPlaywright.launchAndCaptureSession).not.toHaveBeenCalled();
  });

  it('opens interactive browser window when no stored session', async () => {
    const fullCookies = {
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'cookiesession1=SIAP',
      capturedAt: Date.now(),
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
    });
    // Kulon probe fails (delegated to KulonService.checkSessionValid)
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=FRESH',
      siapCookie: '',
      capturedAt: Date.now(),
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
    });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
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
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });

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
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });

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
    });
    mockSessionStore._map.set('09060121130000', {
      identity: '09060121130000',
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now(),
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockPlaywright.launchAndCaptureSession.mockResolvedValue({
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: 'MoodleSession=FRESH',
      siapCookie: '',
      capturedAt: Date.now(),
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
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');

    const svc = makeService();
    const res = await svc.captureSsoSession();

    expect(res.hasKulon).toBe(true);
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
    expect(mockSessionStore.get('24060121130000').kulonCookie).toContain('MoodleSession=K');
  });
});

describe('AuthService.handleSessionHandoff', () => {
  it('verifies, derives identity, stores per-user, and returns a JWT', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');

    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      ssoCookie: 'ci_session_sso=SSO',
    } as any);

    expect(res.hasKulon).toBe(true);
    expect(mockSessionStore.get('24060121130000')).not.toBeNull();
    expect(mockSessionStore.get('24060121130000').kulonCookie).toContain('MoodleSession=K');
  });

  it('throws 401 with code KULON_STALE when the kulon cookie is stale', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=STALE' } as any),
    ).rejects.toMatchObject({
      response: { message: 'Session Kulon tidak valid — silakan login ulang', code: 'KULON_STALE', reason: 'stale' },
    });
  });

  it('retries a transient KULON_STALE probe and succeeds once the session is live', async () => {
    mockKulon.checkSessionValid
      .mockResolvedValueOnce({ valid: false, reason: 'stale' }) // pre-auth/in-flight
      .mockResolvedValueOnce({ valid: true, reason: 'ok' }); // established on retry
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    const svc = makeService();
    const res = await svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=K' } as any);
    expect(res.hasKulon).toBe(true);
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after the attempt cap and still throws KULON_STALE', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=STALE' } as any),
    ).rejects.toMatchObject({ response: { code: 'KULON_STALE' } });
    // initial probe + N retries = total attempts
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the probe fails as no-cookie (no point waiting)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'no-cookie' });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ kulonCookie: '' } as any),
    ).rejects.toMatchObject({ response: { code: 'KULON_NO_COOKIE' } });
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(1);
  });

  it('throws 401 with code KULON_NO_COOKIE when no kulon cookie is provided', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'no-cookie' });
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ kulonCookie: '' } as any),
    ).rejects.toMatchObject({
      response: { code: 'KULON_NO_COOKIE', reason: 'no-cookie' },
    });
  });

  it('throws 400 when identity cannot be derived and none is declared', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue(null);
    const svc = makeService();
    await expect(
      svc.handleSessionHandoff({ kulonCookie: 'MoodleSession=K' } as any),
    ).rejects.toMatchObject({
      response: { message: 'Identitas tidak dapat ditentukan', code: 'IDENTITY_UNRESOLVED' },
    });
  });

  it('rejects a client-supplied identity when derivation fails (B4 - no spoofing)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
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
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=K',
      identity: '24060121130000',
    } as any);
    expect(res.hasSiap).toBe(false);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledWith('ci_session_x=K');
  });

  it('does NOT store a stale SIAP cookie (B5 - strip before store)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=STALE',
      identity: '24060121130000',
    } as any);
    expect(res.hasSiap).toBe(false);
    const stored = mockSessionStore.get('24060121130000');
    expect(stored).not.toBeNull();
    // The stale SIAP cookie must be stripped, not persisted.
    expect(stored.siapCookie).toBe('');
  });

  it('stores a valid SIAP cookie after validation (B5)', async () => {
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockKulon.getSessionIdentity.mockResolvedValue('24060121130000');
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    const svc = makeService();
    const res = await svc.handleSessionHandoff({
      kulonCookie: 'MoodleSession=K',
      siapCookie: 'ci_session_x=VALID',
      identity: '24060121130000',
    } as any);
    expect(res.hasSiap).toBe(true);
    const stored = mockSessionStore.get('24060121130000');
    expect(stored.siapCookie).toBe('ci_session_x=VALID');
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
    const subs = [...mockSessionStore._map.keys()];
    expect(subs[0]).not.toBe(subs[1]);
    // The JWT sub for each resolves to its own stored session.
    expect(mockSessionStore.get(resA.accessToken.replace('jwt-', ''))).not.toBeNull();
    expect(mockSessionStore.get(resB.accessToken.replace('jwt-', ''))).not.toBeNull();
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
    });
    // Kulon probe fails (expired upstream), SIAP probe succeeds.
    mockKulon.checkSessionValid.mockResolvedValue({ valid: false, reason: 'stale' });
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
    });
    mockKulon.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });
    mockSiap.checkSessionValid.mockResolvedValue({ valid: true, reason: 'ok' });

    const svc = makeService();
    await svc.me({ sub: '24060121130000' });
    await svc.me({ sub: '24060121130000' });
    await svc.me({ sub: '24060121130000' });
    // Probe should run once per service, cached for the subsequent calls.
    expect(mockKulon.checkSessionValid).toHaveBeenCalledTimes(1);
    expect(mockSiap.checkSessionValid).toHaveBeenCalledTimes(1);
  });
});
