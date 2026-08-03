import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SSOAuthService } from '../sso/sso-auth.service';
import { MicrosoftAuthService } from '../microsoft/microsoft-auth.service';
import { PlaywrightAuthService } from '../playwright/playwright-auth.service';
import { SessionStore } from '../session/session-store';

@Injectable()
export class AuthService {
  constructor(
    private readonly ssoAuth: SSOAuthService,
    private readonly microsoftAuth: MicrosoftAuthService,
    private readonly playwrightAuth: PlaywrightAuthService,
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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
   * Capture the SSO session from the user's running Chrome via Playwright,
   * store it, and issue a JWT that carries the session reference.
   */
  async captureSsoSession() {
    const cdpUrl = this.config.get<string>('CDP_URL')!;
    const ssoUrl = this.config.get<string>('SSO_DASHBOARD_URL')!;
    const session = await this.playwrightAuth.captureSession(cdpUrl, ssoUrl);
    this.sessionStore.set(session);

    const payload = { sub: 'sso', via: 'playwright' };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      capturedAt: session.capturedAt,
      hasSso: !!session.ssoCookie,
      hasMicrosoft: !!session.microsoftCookie,
      hasKulon: !!session.kulonCookie,
    };
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