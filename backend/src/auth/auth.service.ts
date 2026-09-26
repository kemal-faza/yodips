import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  generateSessionGeneration,
  isSessionGeneration,
} from '../session/session-contract';
import { SessionStore } from '../session/session-store';
import { readLiveSession, sessionDead } from '../session/live-session';
import { KulonService } from '../kulon/kulon.service';
import { SiapService } from '../siap/siap.service';
import { HandoffDto } from './dto/handoff.dto';
import { CachePolicy } from '../cache/cache-policy';
import {
  createNoopTelemetryRuntime,
  elapsedMs,
  recordTelemetry,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type { CacheReadEventInput } from '../observability/telemetry-contract';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly probeCache = new Map<string, { valid: boolean; at: number }>();
  private readonly runtime: TelemetryRuntime;

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kulon: KulonService,
    private readonly siap: SiapService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
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
    const capturedAt = this.runtime.wallNowMs();
    const sessionGeneration = generateSessionGeneration();
    await this.sessionStore.set(identity, {
      identity,
      ssoCookie: dto.ssoCookie ?? '',
      microsoftCookie: dto.microsoftCookie ?? '',
      kulonCookie: dto.kulonCookie,
      siapCookie: siapCheck.valid ? dto.siapCookie ?? '' : '',
      ...(emailSso ? { emailSso } : {}),
      capturedAt,
      sessionGeneration,
    });
    const payload = { sub: identity, via: 'handoff', sessionGeneration };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      capturedAt,
      sessionGeneration,
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
   * (ignoreExpiration) and mint a fresh JWT iff BOTH the backend session record
   * is still alive AND its collision-proof `sessionGeneration` exactly matches
   * the token's `sessionGeneration` claim. A dead record, a legacy record
   * without a generation, or a generation mismatch means the user must
   * re-login (SESSION_DEAD); a missing/ill-typed claim (legacy token) is
   * INVALID_TOKEN. Re-mints are signed with the CURRENT record generation, so
   * a future-generation token can never be produced from an old one.
   * `capturedAt` is lifetime only and never binds a JWT.
   */
  async refresh(token: string) {
    let payload: { sub?: unknown; sessionGeneration?: unknown; via?: unknown };
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
    const sub = typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    const generation = payload?.sessionGeneration;
    if (!sub || !isSessionGeneration(generation)) {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await readLiveSession(this.sessionStore, {
      sub,
      sessionGeneration: generation,
    });
    if (!session) {
      throw sessionDead();
    }
    const accessToken = await this.jwt.signAsync({
      sub,
      via: typeof payload.via === 'string' ? payload.via : 'handoff',
      sessionGeneration: session.sessionGeneration,
    });
    return { accessToken };
  }

  /**
   * Server-side logout. Verifies the SIGNATURE only (ignoreExpiration) so an
   * expired-but-valid JWT can still clear its session, then applies the
   * atomic session-generation semantics via `clearIfGeneration`:
   *  - valid token + live record with a MATCHING generation → cleared, ok.
   *  - valid token + no record (or expired/absolute-dead) → idempotent ok.
   *  - valid token + live record with a DIFFERENT generation, or the CAS lost
   *    to a newer record → SESSION_DEAD, newer session NEVER cleared.
   *  - missing/ill-typed claim, bad signature/iss/aud, or garbage → INVALID_TOKEN,
   *    nothing cleared.
   * `sub` comes only from the signed token (B4); a body-supplied identity is
   * never trusted.
   */
  async logout(bearerToken: string): Promise<{ ok: true }> {
    let payload: { sub?: unknown; sessionGeneration?: unknown };
    try {
      payload = await this.jwt.verifyAsync(bearerToken, {
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
    const sub = typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    const generation = payload?.sessionGeneration;
    if (!sub || !isSessionGeneration(generation)) {
      throw new HttpException(
        { message: 'Token tidak valid', code: 'INVALID_TOKEN' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const cleared = await this.sessionStore.clearIfGeneration(sub, generation);
    if (!cleared) {
      // Mismatch or CAS lost to a newer live session — never cleared.
      throw sessionDead();
    }
    this.logger.log(`SSO session cleared for ${sub}`);
    return { ok: true };
  }

  async me(user: { sub?: unknown; sessionGeneration?: unknown; via?: unknown }) {
    const sub = typeof user?.sub === 'string' && user.sub.length > 0 ? user.sub : null;
    // The one guarded read: guard validated A, but a B-replacement before this
    // read must NOT surface B's cookies/validity to an A-token. A miss (no
    // record, dead, legacy, mismatch) is unauthenticated — never a silent
    // switch to the replacement.
    const session = await readLiveSession(this.sessionStore, user);
    const present = !!session;
    // B1: live-probe validity (Kulon/SIAP) instead of only checking cookie
    // presence. Results are cached ~60s so the boot gate & polls get accurate
    // answers without hammering upstream on every /me.
    const kulonValid =
      present && session?.kulonCookie
        ? await this.probeValid(`${sub}:kulon`, session.kulonCookie, () =>
            this.kulon.checkSessionValid(session.kulonCookie),
          )
        : false;
    const siapValid =
      present && session?.siapCookie
        ? await this.probeValid(`${sub}:siap`, session.siapCookie, () =>
            this.siap.checkSessionValid(session.siapCookie),
          )
        : false;
    // Token via='pair' (perangkat pairing) tidak mensyaratkan presence
    // ssoCookie: sesi sumber Android tidak pernah mengirimnya
    // (HandoffModels.handoffBody hanya siap+kulon) — syarat lama membuat
    // perangkat paired bounce balik ke login selamanya.
    const requireSsoCookie = user?.via !== 'pair';
    return {
      sub,
      authenticated: present,
      hasSso: present ? !!session?.ssoCookie : false,
      hasMicrosoft: present ? !!session?.microsoftCookie : false,
      hasKulon: kulonValid,
      hasSiap: siapValid,
      complete:
        present &&
        (!requireSsoCookie || !!session?.ssoCookie) &&
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
    const started = this.monotonicNowNs();
    const hit = this.probeCache.get(cacheKey);
    if (hit && this.runtime.wallNowMs() - hit.at < CachePolicy.AUTH_PROBE) {
      this.emitProbeRead('hit', started);
      return hit.valid;
    }
    this.emitProbeRead('miss', started);
    const result = await probe();
    this.probeCache.set(cacheKey, { valid: result.valid, at: this.runtime.wallNowMs() });
    return result.valid;
  }

  private emitProbeRead(outcome: 'hit' | 'miss', started: bigint): void {
    const event: CacheReadEventInput = {
      event: 'cache.read',
      cache: 'auth.probe',
      backend: 'memory',
      outcome,
      durationMs: this.durationMs(started),
    };
    recordTelemetry(this.runtime, event);
  }

  private monotonicNowNs(): bigint {
    try {
      const now = this.runtime.monotonicNowNs();
      return typeof now === 'bigint' ? now : 0n;
    } catch {
      return 0n;
    }
  }

  private durationMs(started: bigint): number {
    try {
      return elapsedMs(started, this.monotonicNowNs());
    } catch {
      return 0;
    }
  }
}
