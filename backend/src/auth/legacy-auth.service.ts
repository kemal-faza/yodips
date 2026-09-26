import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { KulonService } from '../kulon/kulon.service';
import { MicrosoftAuthService } from '../microsoft/microsoft-auth.service';
import { PlaywrightAuthService } from '../playwright/playwright-auth.service';
import { SiapService } from '../siap/siap.service';
import { SSOTicketService } from '../sso/ticket.service';
import { SessionStore } from '../session/session-store';
import { generateSessionGeneration, isSessionGeneration } from '../session/session-contract';
import type { CapturedSession } from '../session/session-contract';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';

@Injectable()
export class LegacyAuthService {
  private readonly logger = new Logger(LegacyAuthService.name);
  private readonly SESSION_TTL_MS = 30 * 60_000;
  private readonly runtime: TelemetryRuntime;

  constructor(
    private readonly ssoTicket: SSOTicketService,
    private readonly microsoftAuth: MicrosoftAuthService,
    private readonly playwrightAuth: PlaywrightAuthService,
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kulon: KulonService,
    private readonly siap: SiapService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  /** Dev/test fallback. Its route module is absent in production. */
  async captureSsoSession() {
    // Keep a service-level fail-closed guard in addition to omitting the module
    // in production, so direct invocation cannot bypass the runtime decision.
    if ((this.config.get<string>('NODE_ENV') ?? '') === 'production') {
      throw new HttpException(
        { message: 'Jalur capture tidak tersedia di produksi' },
        HttpStatus.FORBIDDEN,
      );
    }

    const reuseEnabled =
      this.config.get<string>('CAPTURE_REUSE_ENABLED') === 'true';
    const existing = reuseEnabled
      ? await this.findReusableSession()
      : await this.preventReuse();
    if (existing) {
      this.logger.log('Reusing stored SSO session — no browser window needed');
      const payload = {
        sub: existing.identity,
        via: 'reuse',
        sessionGeneration: existing.sessionGeneration,
      };
      const accessToken = await this.jwt.signAsync(payload);
      return {
        accessToken,
        capturedAt: existing.capturedAt,
        sessionGeneration: existing.sessionGeneration,
        reused: true,
        hasSso: !!existing.ssoCookie,
        hasMicrosoft: !!existing.microsoftCookie,
        hasKulon: !!existing.kulonCookie,
        hasSiap: !!existing.siapCookie,
      };
    }

    const loginUrl = this.config.get<string>('SSO_LOGIN_URL')!;
    const dashboardUrl = this.config.get<string>('SSO_DASHBOARD_URL')!;
    const profileDir = this.config.get<string>('CHROME_PROFILE_DIR')!;
    const kulonTicketUrl = this.ssoTicket.buildServiceUrl(
      'kulon',
      this.ssoTicket.generateTicket(),
    );
    const siapTicketUrl = this.ssoTicket.buildServiceUrl(
      'siap',
      this.ssoTicket.generateTicket(),
    );
    const kulonTimeoutMs = Number(
      this.config.get<string>('SSO_CAPTURE_TIMEOUT_MS') ?? 180000,
    );
    const session = await this.playwrightAuth.launchAndCaptureSession(
      profileDir,
      loginUrl,
      dashboardUrl,
      kulonTicketUrl,
      siapTicketUrl,
      5 * 60_000,
      kulonTimeoutMs,
      180000,
    );

    const check = await this.kulon.checkSessionValid(session.kulonCookie);
    const stored = check.valid ? session : { ...session, kulonCookie: '' };
    if (!check.valid) {
      this.logger.warn(
        'Kulon session not verified on capture — stripping kulon cookie',
      );
    }
    const identity = check.valid
      ? (await this.kulon.getSessionIdentity(session.kulonCookie)) ?? 'sso'
      : 'sso';
    await this.sessionStore.set(identity, { ...stored, identity });

    const payload = {
      sub: identity,
      via: 'playwright',
      sessionGeneration: stored.sessionGeneration,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const siapCheck = session.siapCookie
      ? await this.siap.checkSessionValid(session.siapCookie)
      : { valid: false, reason: 'no-cookie' as const };
    return {
      accessToken,
      capturedAt: session.capturedAt,
      sessionGeneration: stored.sessionGeneration,
      reused: false,
      hasSso: !!session.ssoCookie,
      hasMicrosoft: !!session.microsoftCookie,
      hasKulon: check.valid,
      hasSiap: siapCheck.valid,
    };
  }

  private isFresh(session: { capturedAt: number }): boolean {
    return this.runtime.wallNowMs() - session.capturedAt < this.SESSION_TTL_MS;
  }

  private async preventReuse(): Promise<null> {
    return null;
  }

  private async kulonProbeOk(kulonCookie: string): Promise<boolean> {
    const check = await this.kulon.checkSessionValid(kulonCookie);
    return check.valid;
  }

  private async findReusableSession(): Promise<CapturedSession | null> {
    const all = await this.sessionStore.all();
    if (all.length !== 1) return null;
    const [session] = all;
    if (!isSessionGeneration(session.sessionGeneration)) return null;
    if (
      this.isFresh(session) &&
      (await this.kulonProbeOk(session.kulonCookie))
    ) {
      return session;
    }
    return null;
  }

  getMicrosoftAuthUrl() {
    return { authUrl: this.microsoftAuth.getAuthUrl() };
  }

  async handleMicrosoftCallback(code: string, state?: string) {
    const { sessionCookies } = await this.microsoftAuth.handleCallback(
      code,
      state,
    );
    // OIDC state is already validated for CSRF and keeps concurrent attempts
    // from overwriting each other's stored session.
    const identity = state ? `microsoft:${state}` : 'microsoft';
    const capturedAt = this.runtime.wallNowMs();
    const sessionGeneration = generateSessionGeneration();
    await this.sessionStore.set(identity, {
      identity,
      ssoCookie: '',
      microsoftCookie: sessionCookies,
      kulonCookie: '',
      siapCookie: '',
      capturedAt,
      sessionGeneration,
    });
    const payload = { sub: identity, via: 'oidc', sessionGeneration };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken };
  }
}
