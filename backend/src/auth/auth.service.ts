import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SSOAuthService } from '../sso/sso-auth.service';
import { SSOTicketService } from '../sso/ticket.service';
import { MicrosoftAuthService } from '../microsoft/microsoft-auth.service';
import { PlaywrightAuthService } from '../playwright/playwright-auth.service';
import { SessionStore } from '../session/session-store';
import { KulonService } from '../kulon/kulon.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Reuse a stored session only if it was captured within this window.
  private readonly SESSION_TTL_MS = 30 * 60_000; // 30 minutes

  constructor(
    private readonly ssoAuth: SSOAuthService,
    private readonly ssoTicket: SSOTicketService,
    private readonly microsoftAuth: MicrosoftAuthService,
    private readonly playwrightAuth: PlaywrightAuthService,
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kulon: KulonService,
  ) {}

  async login(identity: string, password: string) {
    const baseUrl = this.config.get<string>('SSO_BASE_URL')!;
    const { cookie, redirectUrl } = await this.ssoAuth.login(
      baseUrl,
      identity,
      password,
    );
    // Store session server-side; JWT carries only a reference (not raw cookie).
    this.sessionStore.set({
      identity,
      ssoCookie: cookie,
      microsoftCookie: '',
      kulonCookie: '',
      siapCookie: '',
      capturedAt: Date.now(),
    });
    const payload = { sub: identity, via: 'sso' };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, redirectUrl };
  }

  /**
   * Capture the SSO session via the interactive flow: Playwright opens a
   * visible Chrome window on the SSO login page, the user logs in (NIM +
   * password + MFA), and the captured session is stored server-side. Issues
   * a JWT that carries only a session reference (never raw cookies).
   *
   * Smart reuse: if a stored session is still fresh AND its Kulon cookie is
   * still valid, return a JWT immediately WITHOUT opening a browser window.
   * Otherwise run the interactive flow.
   */
  async captureSsoSession() {
    // 1) Try smart reuse of a stored, still-valid session — no browser window.
    const existing = this.sessionStore.get();
    if (existing && this.isFresh(existing) && (await this.kulonProbeOk(existing.kulonCookie))) {
      this.logger.log('Reusing stored SSO session — no browser window needed');
      const payload = { sub: 'sso', via: 'reuse' };
      const accessToken = await this.jwt.signAsync(payload);
      return {
        accessToken,
        capturedAt: existing.capturedAt,
        reused: true,
        hasSso: !!existing.ssoCookie,
        hasMicrosoft: !!existing.microsoftCookie,
        hasKulon: !!existing.kulonCookie,
      };
    }

    // 2) Interactive flow: open a browser window, let the user log in.
    const loginUrl = this.config.get<string>('SSO_LOGIN_URL')!;
    const dashboardUrl = this.config.get<string>('SSO_DASHBOARD_URL')!;
    const profileDir = this.config.get<string>('CHROME_PROFILE_DIR')!;
    const kulonTicketUrl = this.ssoTicket.buildServiceUrl('kulon', this.ssoTicket.generateTicket());
    const kulonTimeoutMs = Number(this.config.get<string>('SSO_CAPTURE_TIMEOUT_MS') ?? 180000);
    const session = await this.playwrightAuth.launchAndCaptureSession(
      profileDir,
      loginUrl,
      dashboardUrl,
      kulonTicketUrl,
      5 * 60_000,
      kulonTimeoutMs,
    );
    this.sessionStore.set(session);

    const payload = { sub: 'sso', via: 'playwright' };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      capturedAt: session.capturedAt,
      reused: false,
      hasSso: !!session.ssoCookie,
      hasMicrosoft: !!session.microsoftCookie,
      hasKulon: !!session.kulonCookie,
    };
  }

  /** A session is reusable if captured within the TTL window. */
  private isFresh(session: { capturedAt: number }): boolean {
    return Date.now() - session.capturedAt < this.SESSION_TTL_MS;
  }

  /**
   * Lightweight probe: does the stored Kulon cookie still yield a valid
   * Moodle page (has a sesskey)? A stale/expired cookie redirect-loops, which
   * surfaces as a fetch failure — treat that as "not reusable".
   */
  private async kulonProbeOk(kulonCookie: string): Promise<boolean> {
    if (!kulonCookie) return false;
    try {
      const res = await fetch('https://kulon2.undip.ac.id/my/', {
        headers: { Cookie: kulonCookie },
        redirect: 'follow',
      });
      if (!res.ok) return false;
      const html = await res.text();
      return /name="sesskey"/.test(html);
    } catch {
      return false;
    }
  }

  getMicrosoftAuthUrl() {
    return { authUrl: this.microsoftAuth.getAuthUrl() };
  }

  async handleMicrosoftCallback(code: string, state?: string) {
    const { accessToken, sessionCookies } =
      await this.microsoftAuth.handleCallback(code, state);
    // Store microsoft session server-side; JWT carries only a reference.
    this.sessionStore.set({
      identity: 'microsoft',
      ssoCookie: '',
      microsoftCookie: sessionCookies,
      kulonCookie: '',
      siapCookie: '',
      capturedAt: Date.now(),
    });
    const payload = { sub: 'microsoft', via: 'oidc' };
    const jwt = await this.jwt.signAsync(payload);
    return { accessToken: jwt };
  }

  async me(user: any) {
    return { sub: user?.sub, authenticated: true };
  }
}