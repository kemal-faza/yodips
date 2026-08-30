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
import { SiapService } from '../siap/siap.service';
import { HandoffDto } from './dto/handoff.dto';
import { CachePolicy } from '../cache/cache-policy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Reuse a stored session only if it was captured within this window.
  private readonly SESSION_TTL_MS = 30 * 60_000; // 30 minutes
  private readonly probeCache = new Map<string, { valid: boolean; at: number }>();

  constructor(
    private readonly ssoAuth: SSOAuthService,
    private readonly ssoTicket: SSOTicketService,
    private readonly microsoftAuth: MicrosoftAuthService,
    private readonly playwrightAuth: PlaywrightAuthService,
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kulon: KulonService,
    private readonly siap: SiapService,
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
    //    SECURITY: this path uses access to ONE user's stored session to issue
    //    a JWT to an unauthenticated caller (a namespace cross-boundary leak in
    //    a shared deployment), so it is HARD-GATED behind CAPTURE_REUSE_ENABLED
    //    (default OFF). Do NOT enable except in a single-admin private dev env.
    const reuseEnabled =
      this.config.get<string>('CAPTURE_REUSE_ENABLED') === 'true';
    const existing = reuseEnabled
      ? await this.findReusableSession()
      : await this.preventReuse();
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
        hasSiap: !!existing.siapCookie,
      };
    }

    // 2) Interactive flow: open a browser window, let the user log in.
    const loginUrl = this.config.get<string>('SSO_LOGIN_URL')!;
    const dashboardUrl = this.config.get<string>('SSO_DASHBOARD_URL')!;
    const profileDir = this.config.get<string>('CHROME_PROFILE_DIR')!;
    const kulonTicketUrl = this.ssoTicket.buildServiceUrl('kulon', this.ssoTicket.generateTicket());
    const siapTicketUrl = this.ssoTicket.buildServiceUrl('siap', this.ssoTicket.generateTicket());
    const kulonTimeoutMs = Number(this.config.get<string>('SSO_CAPTURE_TIMEOUT_MS') ?? 180000);
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
    const siapCheck = session.siapCookie
      ? await this.siap.checkSessionValid(session.siapCookie)
      : { valid: false, reason: 'no-cookie' as const };
    return {
      accessToken,
      capturedAt: session.capturedAt,
      reused: false,
      hasSso: !!session.ssoCookie,
      hasMicrosoft: !!session.microsoftCookie,
      hasKulon: check.valid,
      hasSiap: siapCheck.valid,
    };
  }

  /** A session is reusable if captured within the TTL window. */
  private isFresh(session: { capturedAt: number }): boolean {
    return Date.now() - session.capturedAt < this.SESSION_TTL_MS;
  }

  /**
   * Explicit no-reuse gate: always returns null so `/sso/capture` falls through
   * to the interactive (headed-browser) flow and NEVER hands an existing stored
   * session to an unauthenticated caller. Replaces `findReusableSession` when
   * the CAPTURE_REUSE_ENABLED flag is unset (the security-safe default).
   */
  private async preventReuse(): Promise<null> {
    return null;
  }

  /** A session is reusable only if its Kulon cookie is still VERIFIED valid. */
  private async kulonProbeOk(kulonCookie: string): Promise<boolean> {
    const check = await this.kulon.checkSessionValid(kulonCookie);
    return check.valid;
  }

  /**
   * Return a fresh, still-valid stored session to reuse — but ONLY when exactly
   * one session exists in the store (single-admin dev path). Once the store
   * holds multiple users' sessions, silently handing any one of them out to an
   * unauthenticated `/sso/capture` caller would leak User A's session to User B
   * (B3). In the multi-user case we force the interactive flow instead.
   */
  private async findReusableSession(): Promise<CapturedSession | null> {
    const all = await this.sessionStore.all();
    if (all.length !== 1) return null;
    const [s] = all;
    if (this.isFresh(s) && (await this.kulonProbeOk(s.kulonCookie))) {
      return s;
    }
    return null;
  }

  getMicrosoftAuthUrl() {
    return { authUrl: this.microsoftAuth.getAuthUrl() };
  }

  async handleMicrosoftCallback(code: string, state?: string) {
    const { accessToken, sessionCookies } =
      await this.microsoftAuth.handleCallback(code, state);
    // Key the stored Microsoft session by the OIDC `state` (already validated
    // for CSRF) instead of a shared literal — otherwise concurrent users would
    // overwrite each other's session (B10). The `state` is unique per login
    // attempt, so the JWT sub is a stable reference to that session.
    const identity = state ? `microsoft:${state}` : 'microsoft';
    await this.sessionStore.set(identity, {
      identity,
      ssoCookie: '',
      microsoftCookie: sessionCookies,
      kulonCookie: '',
      siapCookie: '',
      capturedAt: Date.now(),
    });
    const payload = { sub: identity, via: 'oidc' };
    const jwt = await this.jwt.signAsync(payload);
    return { accessToken: jwt };
  }

  /**
   * Remote-production login: accept session cookies already captured on the
   * user's device (via the capture tool). No credentials ever reach the backend.
   * Verify the Kulon session, derive identity, store per-user, issue a JWT.
   *
   * The Kulon probe is retried on `stale` because after the SSO→Kulon cascade
   * the MoodleSession cookie is set BEFORE the Kulon session is fully
   * established (a few seconds of in-flight redirects). A single immediate
   * probe would reject a perfectly fresh login. `no-cookie` is NOT retried —
   * waiting cannot conjure a cookie that was never sent.
   */
  async handleSessionHandoff(dto: HandoffDto) {
    const retryMs = Number(this.config.get('HANDOFF_KULON_RETRY_DELAY_MS') ?? 2000);
    let check = await this.kulon.checkSessionValid(dto.kulonCookie);
    for (let attempt = 1; !check.valid && check.reason === 'stale' && attempt < 3; attempt++) {
      this.logger.warn(
        `Kulon probe stale (attempt ${attempt}/3) — retrying in ${retryMs}ms`,
      );
      await new Promise((r) => setTimeout(r, retryMs));
      check = await this.kulon.checkSessionValid(dto.kulonCookie);
    }
    if (!check.valid) {
      const code = check.reason === 'no-cookie' ? 'KULON_NO_COOKIE' : 'KULON_STALE';
      throw new HttpException(
        {
          message: 'Session Kulon tidak valid. Silakan login ulang',
          code,
          reason: check.reason,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const derived = await this.kulon.getSessionIdentity(dto.kulonCookie);
    // B4: never trust a client-supplied identity. If we cannot derive one from
    // the Kulon session (the only verifiable source), fail instead of storing
    // the attacker's cookie under a spoofed identity.
    const identity = derived;
    if (!identity) {
      throw new HttpException(
        { message: 'Identitas tidak dapat ditentukan', code: 'IDENTITY_UNRESOLVED' },
        HttpStatus.BAD_REQUEST,
      );
    }
    // B5: validate the SIAP cookie BEFORE storing so a stale cookie is never
    // persisted (mirrors how an unverified Kulon cookie is stripped above).
    // The SIAP probe is retried on `stale` exactly like Kulon: after the
    // SSO→Kulon→SIAP cascade the `sia_app_session` cookie is set before the
    // Laravel session is fully established server-side. Without this retry, a
    // freshly-completed cascade spuriously reports hasSiap:false → the client
    // re-opens SIAP login → cookie churn → reloginCount climbs until a retry
    // happens to land after propagation. `no-cookie` is NOT retried.
    let siapCheck =
      dto.siapCookie && dto.siapCookie !== ''
        ? await this.siap.checkSessionValid(dto.siapCookie)
        : { valid: false, reason: 'no-cookie' as const };
    for (
      let attempt = 1;
      !siapCheck.valid && siapCheck.reason === 'stale' && attempt < 3;
      attempt++
    ) {
      this.logger.warn(
        `SIAP probe stale (attempt ${attempt}/3) — retrying in ${retryMs}ms`,
      );
      await new Promise((r) => setTimeout(r, retryMs));
      siapCheck = await this.siap.checkSessionValid(dto.siapCookie ?? '');
    }
    // emailSso is required to mint the SIAP API token. Fetch it from the (now
    // public) scrape of the profile — but ONLY if the SIAP session is valid, and
    // NEVER let a scrape failure fail the handoff (a stale SIAP session must not
    // block Kulon-valid logins). A missing emailSso is handled downstream by the
    // resolveSiapIdentity fallback-scrape.
    let emailSso = '';
    if (siapCheck.valid && dto.siapCookie) {
      try {
        const profile = await this.siap.fetchProfile(dto.siapCookie);
        emailSso = profile.emailSso ?? '';
      } catch {
        emailSso = ''; // ignore; resolveSiapIdentity will fallback-scrape once
      }
    }
    await this.sessionStore.set(identity, {
      identity,
      ssoCookie: dto.ssoCookie ?? '',
      microsoftCookie: dto.microsoftCookie ?? '',
      kulonCookie: dto.kulonCookie,
      siapCookie: siapCheck.valid ? dto.siapCookie ?? '' : '',
      ...(emailSso ? { emailSso } : {}),
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
      hasSiap: siapCheck.valid,
    };
  }

  /**
   * Silent JWT rotation. The incoming token may be expired (JWT_EXPIRES_IN=12h
   * is far shorter than the 7d sliding session), so verify the SIGNATURE only
   * (ignoreExpiration) and mint a fresh JWT iff the backend session record is
   * still alive. A dead record means the user must re-login (SESSION_DEAD).
   */
  async refresh(token: string) {
    let payload: { sub?: string; via?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
        ignoreExpiration: true,
        algorithms: ['HS256'],
        issuer: 'yodips',
        audience: 'yodips-web',
      });
    } catch {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const sub = payload?.sub;
    if (!sub) {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.sessionStore.get(sub);
    if (!session) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const accessToken = await this.jwt.signAsync({
      sub,
      via: typeof payload.via === 'string' ? payload.via : 'handoff',
    });
    return { accessToken };
  }

  async me(user: any) {
    const session = await this.sessionStore.get(user?.sub);
    const present = !!session;
    // B1: live-probe validity (Kulon/SIAP) instead of only checking cookie
    // presence. Results are cached ~60s so the boot gate & polls get accurate
    // answers without hammering upstream on every /me.
    const kulonValid =
      present && session.kulonCookie
        ? await this.probeValid(`${user.sub}:kulon`, session.kulonCookie, () =>
            this.kulon.checkSessionValid(session.kulonCookie),
          )
        : false;
    const siapValid =
      present && session.siapCookie
        ? await this.probeValid(`${user.sub}:siap`, session.siapCookie, () =>
            this.siap.checkSessionValid(session.siapCookie),
          )
        : false;
    // Token via='pair' (perangkat pairing) tidak mensyaratkan presence
    // ssoCookie: sesi sumber Android tidak pernah mengirimnya
    // (HandoffModels.handoffBody hanya siap+kulon) — syarat lama membuat
    // perangkat paired bounce balik ke login selamanya.
    const requireSsoCookie = user?.via !== 'pair';
    return {
      sub: user?.sub,
      authenticated: present,
      hasSso: present ? !!session.ssoCookie : false,
      hasMicrosoft: present ? !!session.microsoftCookie : false,
      hasKulon: kulonValid,
      hasSiap: siapValid,
      complete:
        present &&
        (!requireSsoCookie || !!session.ssoCookie) &&
        kulonValid &&
        siapValid,
    };
  }

  /**
   * Run `probe()` and cache its boolean result for CachePolicy.AUTH_PROBE, keyed by
   * `key` (which embeds the user sub + service). The cookie value acts as a
   * natural invalidation signal: a changed cookie produces a different key.
   */
  private async probeValid(
    key: string,
    cookie: string,
    probe: () => Promise<{ valid: boolean }>,
  ): Promise<boolean> {
    const cacheKey = `${key}:${cookie}`;
    const hit = this.probeCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CachePolicy.AUTH_PROBE) return hit.valid;
    const result = await probe();
    this.probeCache.set(cacheKey, { valid: result.valid, at: Date.now() });
    return result.valid;
  }
}