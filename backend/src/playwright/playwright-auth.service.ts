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

      if (!ssoCookie) {
        throw new Error('SSO session not found — user may be logged out');
      }

      return {
        identity: '',
        ssoCookie,
        microsoftCookie,
        kulonCookie,
        siapCookie,
        capturedAt: Date.now(),
      };
    } finally {
      await browser.close();
    }
  }
}