import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';

export interface CapturedSession {
  identity: string;
  ssoCookie: string;
  microsoftCookie: string;
  kulonCookie: string;
  siapCookie: string;
  capturedAt: number;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const KULON_TIMEOUT_MS = 30_000; // 30 seconds for Kulon session establish
const POLL_INTERVAL_MS = 2_000;

@Injectable()
export class PlaywrightAuthService {
  private readonly logger = new Logger(PlaywrightAuthService.name);

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
   * After SSO auth is confirmed, navigate to the Kulon ticket URL so the
   * MoodleSession cookie is established in the same browser context, then
   * capture all cookies. The persistent profile keeps the user logged in,
   * so repeat logins are instant. The timeout guards against abandonment.
   */
  async launchAndCaptureSession(
    profileDir: string,
    loginUrl: string,
    dashboardUrl: string,
    kulonTicketUrl: string,
    loginTimeoutMs: number = DEFAULT_LOGIN_TIMEOUT_MS,
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

      // Establish the Kulon session so the MoodleSession cookie exists.
      await this.establishKulonSession(page, context, kulonTicketUrl);

      const cookies = await context.cookies();
      const session = this.buildSession(cookies, '');
      this.logger.log('SSO session captured via interactive browser login');
      return session;
    } finally {
      await context.close();
    }
  }

  /** Detect authentication by URL reaching the dashboard (not cookie presence). */
  private isOnDashboard(currentUrl: string, dashboardUrl: string): boolean {
    return currentUrl.includes(dashboardUrl);
  }

  /**
   * Navigate to the Kulon ticket URL so the Moodle OIDC flow issues a
   * MoodleSession cookie in the same browser context. Best-effort: if it
   * fails (e.g. Microsoft OIDC needs extra interaction), log and continue
   * with whatever cookies exist — the dashboard will show gracefully.
   */
  private async establishKulonSession(
    page: { goto: (url: string, opts?: unknown) => Promise<unknown> },
    context: { cookies: () => Promise<{ name: string; domain: string }[]> },
    kulonTicketUrl: string,
  ): Promise<void> {
    try {
      await page.goto(kulonTicketUrl, { waitUntil: 'domcontentloaded' });
      // Wait for the MoodleSession cookie to appear (up to ~30s).
      const deadline = Date.now() + KULON_TIMEOUT_MS;
      let cookies = await context.cookies();
      while (!this.hasKulonCookie(cookies)) {
        if (Date.now() > deadline) {
          this.logger.warn('Kulon session not established within timeout');
          return;
        }
        await this.sleep(POLL_INTERVAL_MS);
        cookies = await context.cookies();
      }
      this.logger.log('Kulon session established');
    } catch (e) {
      this.logger.warn(`Kulon session establish failed: ${(e as Error).message}`);
    }
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
    const kulonCookie = cookies
      .filter((c) => c.domain.includes('kulon2.undip.ac.id'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
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

  private hasKulonCookie(cookies: { name: string; domain: string }[]): boolean {
    return cookies.some(
      (c) => c.name === 'MoodleSession' && c.domain.includes('kulon2.undip.ac.id'),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}