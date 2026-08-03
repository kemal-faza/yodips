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
  session: null,
  set(s: any) { this.session = s; },
  get() { return this.session; },
  clear() { this.session = null; },
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

function makeService() {
  return new AuthService(
    mockSsoAuth as any,
    mockSsoTicket as any,
    mockMicrosoftAuth as any,
    mockPlaywright as any,
    mockSessionStore as any,
    mockJwt as any,
    mockConfig as any,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStore.session = null;
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
    mockSessionStore.session = {
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: 'ESTSAUTH=MS',
      kulonCookie: 'MoodleSession=K',
      siapCookie: '',
      capturedAt: Date.now(),
    };
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
    );
    expect(mockSessionStore.session).not.toBeNull();
  });

  it('opens interactive window when stored session probe fails (stale cookie)', async () => {
    mockSessionStore.session = {
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=STALE',
      capturedAt: Date.now(),
    };
    // Kulon probe fails (redirect-loop / no sesskey in page)
    (global.fetch as jest.Mock).mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: new Error('redirect count exceeded') }),
    );
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
    mockSessionStore.session = {
      ssoCookie: 'ci_session_sso=SSO',
      kulonCookie: 'MoodleSession=K',
      capturedAt: Date.now() - 60 * 60 * 1000, // 1h old
    };
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
});
