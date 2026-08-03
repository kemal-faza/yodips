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

  beforeEach(() => {
    svc = new PlaywrightAuthService();
    jest.clearAllMocks();
  });

  it('launches headed persistent context, navigates to login, captures cookies after login', async () => {
    const cookiesFn = jest.fn();
    // First call: no sso cookie yet (user still logging in). Second call: logged in.
    cookiesFn
      .mockResolvedValueOnce([{ name: 'other', value: 'x', domain: 'other.com' }])
      .mockResolvedValueOnce([
        { name: 'ci_session_sso', value: 'SSO', domain: '.sso.undip.ac.id' },
        { name: 'ESTSAUTH', value: 'MS', domain: '.login.microsoftonline.com' },
        { name: 'MoodleSession', value: 'KULON', domain: 'kulon2.undip.ac.id' },
        { name: 'cookiesession1', value: 'SIAP', domain: 'siap.undip.ac.id' },
      ]);
    const mockContext = {
      pages: jest.fn().mockReturnValue([{ goto: jest.fn().mockResolvedValue(undefined) }]),
      cookies: cookiesFn,
      close: jest.fn(),
    };
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValue(mockContext);

    const session = await svc.launchAndCaptureSession(
      '/tmp/test-profile',
      'https://sso.undip.ac.id/auth/user/login',
      'https://sso.undip.ac.id/pages/dashboard',
    );

    expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
      '/tmp/test-profile',
      expect.objectContaining({ headless: false, executablePath: '/usr/bin/google-chrome' }),
    );
    expect(session.ssoCookie).toContain('ci_session_sso=SSO');
    expect(session.kulonCookie).toContain('MoodleSession=KULON');
    expect(session.microsoftCookie).toContain('ESTSAUTH=MS');
    expect(session.siapCookie).toContain('cookiesession1=SIAP');
    expect(mockContext.close).toHaveBeenCalled();
  });

  it('throws after timeout when user never logs in', async () => {
    const cookiesFn = jest.fn().mockResolvedValue([{ name: 'other', value: 'x', domain: 'other.com' }]);
    const mockContext = {
      pages: jest.fn().mockReturnValue([{ goto: jest.fn().mockResolvedValue(undefined) }]),
      cookies: cookiesFn,
      close: jest.fn(),
    };
    (chromium.launchPersistentContext as jest.Mock).mockResolvedValue(mockContext);

    // Use a tiny timeout so the test doesn't wait 5 minutes.
    await expect(
      svc.launchAndCaptureSession(
        '/tmp/test-profile',
        'https://sso.undip.ac.id/auth/user/login',
        'https://sso.undip.ac.id/pages/dashboard',
        50,
      ),
    ).rejects.toThrow('Timed out waiting for SSO login');
    expect(mockContext.close).toHaveBeenCalled();
  });
});