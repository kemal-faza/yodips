import 'reflect-metadata';
import { PlaywrightAuthService } from './playwright-auth.service';

jest.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: jest.fn(),
    launchPersistentContext: jest.fn(),
  },
}));

import { chromium } from 'playwright-core';

describe('PlaywrightAuthService', () => {
  let svc: PlaywrightAuthService;

  beforeEach(() => {
    svc = new PlaywrightAuthService();
    jest.clearAllMocks();
  });

  it('captures sso, microsoft, kulon and siap cookies', async () => {
    const mockContext = {
      pages: () => [{ url: () => 'https://sso.undip.ac.id/dashboard', goto: jest.fn() }],
      cookies: jest.fn().mockResolvedValue([
        { name: 'ci_session_sso', value: 'SSO', domain: '.sso.undip.ac.id' },
        { name: 'csrf_cookie_sso', value: 'CSRF', domain: '.sso.undip.ac.id' },
        { name: 'ESTSAUTH', value: 'MS', domain: '.login.microsoftonline.com' },
        { name: 'MoodleSession', value: 'KULON', domain: 'kulon2.undip.ac.id' },
        { name: 'cookiesession1', value: 'SIAP', domain: 'siap.undip.ac.id' },
      ]),
    };
    const mockBrowser = { close: jest.fn() };
    (chromium.connectOverCDP as jest.Mock).mockResolvedValue({
      contexts: () => [mockContext],
      ...mockBrowser,
    });

    const session = await svc.captureSession(
      'http://127.0.0.1:9223',
      'https://sso.undip.ac.id/pages/dashboard',
    );

    expect(session.ssoCookie).toContain('ci_session_sso=SSO');
    expect(session.microsoftCookie).toContain('ESTSAUTH=MS');
    expect(session.kulonCookie).toContain('MoodleSession=KULON');
    expect(session.siapCookie).toContain('cookiesession1=SIAP');
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9223');
  });

  it('throws when no SSO session cookie found', async () => {
    const mockContext = {
      pages: () => [{ url: () => 'https://sso.undip.ac.id/dashboard', goto: jest.fn() }],
      cookies: jest.fn().mockResolvedValue([{ name: 'other', value: 'x', domain: 'other.com' }]),
    };
    (chromium.connectOverCDP as jest.Mock).mockResolvedValue({
      contexts: () => [mockContext],
      close: jest.fn(),
    });

    await expect(
      svc.captureSession('http://127.0.0.1:9223', 'https://sso.undip.ac.id/pages/dashboard'),
    ).rejects.toThrow('SSO session not found');
  });
});

describe('launchAndCaptureSession', () => {
  let svc: PlaywrightAuthService;
  const LOGIN_URL = 'https://sso.undip.ac.id/auth/user/login';
  const DASHBOARD_URL = 'https://sso.undip.ac.id/pages/dashboard';
  const KULON_URL = 'https://kulon2.undip.ac.id/auth/oidc/?t=dGVzdA';

  beforeEach(() => {
    svc = new PlaywrightAuthService();
    jest.clearAllMocks();
  });

  function makePage(urlMock: jest.Mock) {
    return { url: urlMock, goto: jest.fn().mockResolvedValue(undefined) };
  }

  function makeContext(page: any, cookiesFn: jest.Mock) {
    return {
      pages: jest.fn().mockReturnValue([page]),
      cookies: cookiesFn,
      close: jest.fn(),
    };
  }

  const fullCookies = [
    { name: 'ci_session_sso', value: 'SSO', domain: '.sso.undip.ac.id' },
    { name: 'ESTSAUTH', value: 'MS', domain: '.login.microsoftonline.com' },
    { name: 'MoodleSession', value: 'KULON', domain: 'kulon2.undip.ac.id' },
    { name: 'cookiesession1', value: 'SIAP', domain: 'siap.undip.ac.id' },
  ];

  it('waits for URL to reach dashboard (real auth signal), then establishes Kulon and captures', async () => {
    // URL moves from login page -> dashboard after user logs in.
    const urlMock = jest
      .fn()
      .mockReturnValueOnce(LOGIN_URL)
      .mockReturnValue(DASHBOARD_URL);
    const page = makePage(urlMock);
    const cookiesFn = jest.fn().mockResolvedValue(fullCookies);
    const mockContext = makeContext(page, cookiesFn);
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValue(mockContext);

    const session = await svc.launchAndCaptureSession(
      '/tmp/test-profile',
      LOGIN_URL,
      DASHBOARD_URL,
      KULON_URL,
    );

    expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
      '/tmp/test-profile',
      expect.objectContaining({ headless: false, executablePath: '/usr/bin/google-chrome' }),
    );
    expect(page.goto).toHaveBeenCalledWith(LOGIN_URL, expect.anything());
    // After auth, navigate to Kulon ticket URL to establish MoodleSession.
    expect(page.goto).toHaveBeenCalledWith(KULON_URL, expect.anything());
    expect(session.ssoCookie).toContain('ci_session_sso=SSO');
    expect(session.kulonCookie).toContain('MoodleSession=KULON');
    expect(session.microsoftCookie).toContain('ESTSAUTH=MS');
    expect(session.siapCookie).toContain('cookiesession1=SIAP');
    expect(mockContext.close).toHaveBeenCalled();
  });

  it('captures immediately when already on dashboard (already logged in)', async () => {
    const urlMock = jest.fn().mockReturnValue(DASHBOARD_URL);
    const page = makePage(urlMock);
    const cookiesFn = jest.fn().mockResolvedValue(fullCookies);
    const mockContext = makeContext(page, cookiesFn);
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValue(mockContext);

    const session = await svc.launchAndCaptureSession(
      '/tmp/test-profile',
      LOGIN_URL,
      DASHBOARD_URL,
      KULON_URL,
    );

    expect(session.ssoCookie).toContain('ci_session_sso=SSO');
    expect(page.goto).toHaveBeenCalledWith(LOGIN_URL, expect.anything());
    expect(mockContext.close).toHaveBeenCalled();
  });

  it('throws after timeout when user never reaches dashboard', async () => {
    const urlMock = jest.fn().mockReturnValue(LOGIN_URL);
    const page = makePage(urlMock);
    const cookiesFn = jest.fn().mockResolvedValue([{ name: 'other', value: 'x', domain: 'other.com' }]);
    const mockContext = makeContext(page, cookiesFn);
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValue(mockContext);

    // Use a tiny timeout so the test doesn't wait 5 minutes.
    await expect(
      svc.launchAndCaptureSession(
        '/tmp/test-profile',
        LOGIN_URL,
        DASHBOARD_URL,
        KULON_URL,
        50,
      ),
    ).rejects.toThrow('Timed out waiting for SSO login');
    expect(mockContext.close).toHaveBeenCalled();
  });
});