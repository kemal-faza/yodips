import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';
import { KulonService } from '../kulon/kulon.service';

export interface CapturedSession {
  identity: string;
  ssoCookie: string;
  microsoftCookie: string;
  kulonCookie: string;
  siapCookie: string;
  capturedAt: number;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const KULON_TIMEOUT_MS = 3 * 60_000; // 3 minutes for a verified Kulon session
const POLL_INTERVAL_MS = 2_000;

@Injectable()
export class PlaywrightAuthService {
  private readonly logger = new Logger(PlaywrightAuthService.name);

  constructor(private readonly kulon: KulonService) {
    // no-op — KulonService injected for session-validity probing
  }

  /**
   * Connect to the user's running Chrome via CDP and capture the SSO +
   * Microsoft + service session cookies. Returns a normalized session object.
   */
  async captureSession(
    cdpUrl: string,
    ssoUrl: string,
  ): Promise<CapturedSession> {
    // Connect to the user's running Chrome via CDP.
    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error('No browser context found');

      const page = context.pages().find((p) => p.url().includes('undip')) || context.pages()[0];
      if (!page) throw new Error('No page available');

      // Ensure we are on the SSO dashboard so the session is active.
      await page.goto(ssoUrl, { waitUntil: 'domcontentloaded' });
      const cookies = await context.cookies();

      const session = this.buildSession(cookies, '');
      if (!session.ssoCookie) {
        throw new Error('SSO session not found — user may be logged out');
      }

      return session;
    } finally {
      await browser.close();
    }
  }

  /**
   * Launch a HEADED persistent Chromium context (visible browser window),
   * navigate to the SSO login page, and wait until the user completes login —
   * detected by the page URL reaching the dashboard (a reliable auth signal,
   * unlike a cookie which SSO sets on the login-page GET itself).
   *
   * After SSO auth is confirmed, navigate to the Kulon ticket URL and keep
   * waiting until the Kulon session is VERIFIED VALID (not merely present) —
   * the user completes any Microsoft/Moodle login in the visible window.
   * The persistent profile keeps the user logged in, so repeat logins are
   * instant. Throws on deadline so a stale session is never returned.
   */
  async launchAndCaptureSession(
    profileDir: string,
    loginUrl: string,
    dashboardUrl: string,
    kulonTicketUrl: string,
    loginTimeoutMs: number = DEFAULT_LOGIN_TIMEOUT_MS,
    kulonTimeoutMs: number = KULON_TIMEOUT_MS,
  ): Promise<CapturedSession> {
    // Point Playwright at the system Chrome so a real, visible window opens.
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath: '/usr/bin/google-chrome',
      viewport: { width: 1280, height: 800 },
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // Navigate to the SSO login page. If the persistent profile is already
      // logged in, the page redirects to the dashboard automatically.
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

      // Wait for the real auth signal: the page URL reaches the dashboard.
      const deadline = Date.now() + loginTimeoutMs;
      while (!this.isOnDashboard(page.url(), dashboardUrl)) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for SSO login');
        }
        await this.sleep(POLL_INTERVAL_MS);
      }
      this.logger.log('SSO login detected — on dashboard');

      await this.establishKulonSession(context, kulonTicketUrl, kulonTimeoutMs);

      const cookies = await context.cookies();
      const session = this.buildSession(cookies, '');
      this.logger.log('SSO session captured with verified Kulon session');
      return session;
    } finally {
      await context.close();
    }
  }

  /**
   * Navigate to the Kulon ticket URL and keep polling until the Kulon session
   * is VERIFIED VALID (via KulonService.checkSessionValid), not merely present.
   * If the flow lands on a Microsoft/Moodle login page, keep waiting — the
   * user completes it in the visible browser window. Throws on deadline so a
   * stale session is never returned.
   */
  private async establishKulonSession(
    context: { pages: () => { url: () => string; goto: (u: string, o?: unknown) => Promise<unknown> }[]; cookies: () => Promise<{ name: string; value: string; domain: string }[]> },
    kulonTicketUrl: string,
    kulonTimeoutMs: number,
  ): Promise<void> {
    const page = context.pages()[0];
    await page.goto(kulonTicketUrl, { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + kulonTimeoutMs;
    while (true) {
      const cookies = await context.cookies();
      const cookieStr = this.kulonCookieString(cookies);
      const check = await this.kulon.checkSessionValid(cookieStr);
      if (check.valid) {
        this.logger.log('Kulon session verified');
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'Kulon session tidak terverifikasi — silakan selesaikan login di window browser atau coba lagi nanti',
        );
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  /** Build the `name=value; ...` cookie string for the Kulon domain. */
  private kulonCookieString(cookies: { name: string; value: string; domain: string }[]): string {
    return cookies
      .filter((c) => c.domain.includes('kulon2.undip.ac.id'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** Detect authentication by URL reaching the dashboard (not cookie presence). */
  private isOnDashboard(currentUrl: string, dashboardUrl: string): boolean {
    return currentUrl.includes(dashboardUrl);
  }

  /** Extract the sso/microsoft/kulon/siap cookie strings from a cookie list. */
  private buildSession(cookies: { name: string; value: string; domain: string }[], identity: string): CapturedSession {
    const ssoCookie = cookies
      .filter((c) => c.domain.includes('sso.undip.ac.id'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const microsoftCookie = cookies
      .filter((c) => c.domain.includes('microsoftonline.com') || c.domain.includes('login.live.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const kulonCookie = this.kulonCookieString(cookies);
    const siapCookie = cookies
      .filter((c) => c.domain.includes('siap.undip.ac.id'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    return {
      identity,
      ssoCookie,
      microsoftCookie,
      kulonCookie,
      siapCookie,
      capturedAt: Date.now(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}