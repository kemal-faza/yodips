import 'reflect-metadata';
import { AuthService } from './auth.service';
import { SSOTicketService } from '../sso/ticket.service';
import { SessionStore } from '../session/session-store';

const mockSsoTicket = {
  generateTicket: jest.fn(() => 'dGVzdA'),
  buildServiceUrl: jest.fn((service: string, t: string) => `https://kulon2.undip.ac.id/auth/oidc/?t=${t}`),
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
