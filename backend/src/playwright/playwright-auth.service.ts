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
   * navigate to the SSO login page, and poll until the user completes login
   * (a `ci_session_sso` cookie appears). Returns a normalized session.
   *
   * The persistent profile keeps the user logged in across calls, so repeat
   * logins are instant. The timeout guards against the user abandoning login.
   */
  async launchAndCaptureSession(
    profileDir: string,
    loginUrl: string,
    _dashboardUrl: string,
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
      if (this.hasSsoCookie(await context.cookies())) {
        this.logger.log('SSO session already present in profile — no login needed');
      } else {
        this.logger.log('Waiting for user to log in on the SSO page…');
      }

      const deadline = Date.now() + loginTimeoutMs;
      let cookies = await context.cookies();
      while (!this.hasSsoCookie(cookies)) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for SSO login');
        }
        await this.sleep(POLL_INTERVAL_MS);
        cookies = await context.cookies();
      }

      const session = this.buildSession(cookies, '');
      this.logger.log('SSO session captured via interactive browser login');
      return session;
    } finally {
      await context.close();
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

  private hasSsoCookie(cookies: { name: string; domain: string }[]): boolean {
    return cookies.some(
      (c) => c.name === 'ci_session_sso' && c.domain.includes('sso.undip.ac.id'),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}