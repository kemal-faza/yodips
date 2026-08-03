import 'reflect-metadata';
import { PlaywrightAuthService } from './playwright-auth.service';

jest.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: jest.fn(),
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