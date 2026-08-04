import { Injectable, Logger } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SSOAuthService } from '../sso/sso-auth.service';
import { SSOTicketService } from '../sso/ticket.service';
import { MicrosoftAuthService } from '../microsoft/microsoft-auth.service';
import { PlaywrightAuthService, CapturedSession } from '../playwright/playwright-auth.service';
import { SessionStore } from '../session/session-store';
import { KulonService } from '../kulon/kulon.service';
import { HandoffDto } from './dto/handoff.dto';

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
    // Store session server-side keyed by identity; JWT carries only a reference (not raw cookie).
    await this.sessionStore.set(identity, {
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
    const existing = await this.findReusableSession();
    if (existing) {
      this.logger.log('Reusing stored SSO session — no browser window needed');
      const payload = { sub: existing.identity, via: 'reuse' };
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

    const check = await this.kulon.checkSessionValid(session.kulonCookie);
    const stored = check.valid ? session : { ...session, kulonCookie: '' };
    if (!check.valid) {
      this.logger.warn('Kulon session not verified on capture — stripping kulon cookie');
    }
    // Derive identity from the Kulon session when possible; fall back to a
    // placeholder. The interactive flow is a single-admin dev path, so the
    // placeholder never collides with a real per-user key in production.
    const identity = check.valid
      ? (await this.kulon.getSessionIdentity(session.kulonCookie)) ?? 'sso'
      : 'sso';
    await this.sessionStore.set(identity, { ...stored, identity });

    const payload = { sub: identity, via: 'playwright' };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      capturedAt: session.capturedAt,
      reused: false,
      hasSso: !!session.ssoCookie,
      hasMicrosoft: !!session.microsoftCookie,
      hasKulon: check.valid,
    };
  }

  /** A session is reusable if captured within the TTL window. */
  private isFresh(session: { capturedAt: number }): boolean {
    return Date.now() - session.capturedAt < this.SESSION_TTL_MS;
  }

  /** A session is reusable only if its Kulon cookie is still VERIFIED valid. */
  private async kulonProbeOk(kulonCookie: string): Promise<boolean> {
    const check = await this.kulon.checkSessionValid(kulonCookie);
    return check.valid;
  }

  /** Return the first fresh, still-valid stored session across all users. */
  private async findReusableSession(): Promise<CapturedSession | null> {
    for (const s of await this.sessionStore.all()) {
      if (this.isFresh(s) && (await this.kulonProbeOk(s.kulonCookie))) {
        return s;
      }
    }
    return null;
  }

  getMicrosoftAuthUrl() {
    return { authUrl: this.microsoftAuth.getAuthUrl() };
  }

  async handleMicrosoftCallback(code: string, state?: string) {
    const { accessToken, sessionCookies } =
      await this.microsoftAuth.handleCallback(code, state);
    // Store microsoft session server-side keyed by fixed identity; JWT carries only a reference.
    await this.sessionStore.set('microsoft', {
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

  /**
   * Remote-production login: accept session cookies already captured on the
   * user's device (via the capture tool). No credentials ever reach the backend.
   * Verify the Kulon session, derive identity, store per-user, issue a JWT.
   */
  async handleSessionHandoff(dto: HandoffDto) {
    const check = await this.kulon.checkSessionValid(dto.kulonCookie);
    if (!check.valid) {
      throw new HttpException(
        { message: 'Session Kulon tidak valid' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const derived = await this.kulon.getSessionIdentity(dto.kulonCookie);
    const identity = derived ?? dto.identity;
    if (!identity) {
      throw new HttpException(
        { message: 'Identitas tidak dapat ditentukan' },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.sessionStore.set(identity, {
      identity,
      ssoCookie: dto.ssoCookie ?? '',
      microsoftCookie: dto.microsoftCookie ?? '',
      kulonCookie: dto.kulonCookie,
      siapCookie: dto.siapCookie ?? '',
      capturedAt: Date.now(),
    });
    const payload = { sub: identity, via: 'handoff' };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      capturedAt: Date.now(),
      reused: false,
      hasSso: !!dto.ssoCookie,
      hasMicrosoft: !!dto.microsoftCookie,
      hasKulon: true,
    };
  }

  async me(user: any) {
    return { sub: user?.sub, authenticated: true };
  }
}