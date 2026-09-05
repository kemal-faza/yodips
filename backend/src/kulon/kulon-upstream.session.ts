import {
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  getTimedFetchTransportReason,
  isLoginRedirect,
  timedFetch,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
  StaleUpstreamError,
  UpstreamSessionCheck,
} from '../upstream/upstream-fetch';
import { DataCache } from '../cache/data-cache';
import { CachePolicy } from '../cache/cache-policy';
import { SessionStore, SessionRef, isSessionRef, getRegisteredSessionStore } from '../session/session-store';
import {
  cacheKeyForSession,
  currentRefForSession,
} from '../session/session-scope';
import { isSessionGeneration } from '../playwright/playwright-auth.service';
import { createKeyedSingleFlight } from '../common/single-flight';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type { UpstreamReason } from '../observability/telemetry-contract';

export const KULON_BASE_URL = 'https://kulon2.undip.ac.id';
const SESSKEY_FP_LEN = 16;

function route(
  operation: UpstreamRouteContext['operation'],
  path: UpstreamRouteContext['route'],
): UpstreamRouteContext {
  return Object.freeze({ service: 'kulon', operation, route: path }) as UpstreamRouteContext;
}

export const KULON_ROUTE_CONTEXTS = Object.freeze({
  sessionProbe: route('session_probe', 'GET /my/'),
  sessionIdentity: route('session_identity', 'GET /my/'),
  profileIdentity: route('profile_identity', 'GET /user/profile.php'),
  assignmentsIndex: route('assignments_index', 'GET /mod/assign/index.php'),
  quizIndex: route('quiz_index', 'GET /mod/quiz/index.php'),
  assignmentDetail: route('assignment_detail', 'GET /mod/assign/view.php'),
  courseContent: route('course_content', 'GET /course/view.php'),
  sesskey: route('sesskey', 'GET /my/'),
  ajax: route('ajax', 'POST /lib/ajax/service.php'),
});

function staleResult<T>(
  error: unknown,
  reason: UpstreamReason,
  status: number,
): UpstreamAttemptResult<T> {
  return { ok: false, error, outcome: 'stale', reason, status };
}

function httpErrorResult<T>(
  error: unknown,
  status: number,
): UpstreamAttemptResult<T> {
  return { ok: false, error, outcome: 'http_error', reason: 'http-not-ok', status };
}

/** Fingerprint binding a sesskey entry to the exact session cookie material. */
function sesskeyFingerprint(cookie: string): string {
  return createHash('sha256').update(cookie).digest('hex').slice(0, SESSKEY_FP_LEN);
}

/** Pull the AJAX sesskey out of a Kulon page (present only when authed). */
export function parseSesskey(html: string): string {
  const match = html.match(/name="sesskey"\s+value="([^"]+)"/);
  if (!match) throw new Error('sesskey not found in Kulon page');
  return match[1];
}

function hasSesskeyMarker(html: string): boolean {
  return /name="sesskey"/.test(html);
}

/**
 * Kulon's one session seam: validity probe + sesskey + authenticated AJAX
 * transport + stale classification. Replaces the duplicated plumbing that
 * used to live in KulonService.checkSessionValid and KulonSessionProbe.
 */
@Injectable()
export class KulonUpstreamSession {
  private readonly sessionStore?: SessionStore;
  private readonly cache?: DataCache;
  private readonly runtime: TelemetryRuntime;
  private readonly sesskeyFlight = createKeyedSingleFlight<string>();

  constructor(
    @Optional() sessionStore?: SessionStore,
    @Optional() cache?: DataCache,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.sessionStore = sessionStore ?? getRegisteredSessionStore() ?? undefined;
    this.cache = cache;
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  /**
   * Single source of truth for Kulon session validity. A real session makes
   * GET /my/ return a page containing a `sesskey`; stale sessions redirect to
   * a Moodle login page / Microsoft OIDC or loop redirects — all map to
   * `stale` without throwing.
   */
  checkSessionValid(cookie: string): Promise<UpstreamSessionCheck> {
    if (!cookie) return Promise.resolve({ valid: false, reason: 'no-cookie' });
    return timedFetch(
      this.runtime,
      KULON_ROUTE_CONTEXTS.sessionProbe,
      `${KULON_BASE_URL}/my/`,
      { headers: { Cookie: cookie }, redirect: 'follow' },
      async (res): Promise<UpstreamAttemptResult<UpstreamSessionCheck>> => {
        if (!res.ok) {
          return httpErrorResult(
            new StaleUpstreamError('Kulon', 'http-not-ok'),
            res.status,
          );
        }
        if (isLoginRedirect(res.url)) {
          return staleResult(
            new StaleUpstreamError('Kulon', 'login-redirect'),
            'login-redirect',
            res.status,
          );
        }
        const html = await res.text();
        if (!hasSesskeyMarker(html)) {
          return staleResult(
            new StaleUpstreamError('Kulon', 'login-redirect'),
            'login-redirect',
            res.status,
          );
        }
        return { ok: true, value: { valid: true, reason: 'ok' }, outcome: 'ok', status: res.status };
      },
    ).catch(() => ({ valid: false, reason: 'stale' as const }));
  }

  /** Cookie + cached sesskey for a user. Cookie is ALWAYS read from the session
   *  store (never cached); sesskey is cached (fingerprint key, 5 min TTL) with
   *  single-flight. Missing session -> typed stale 401.
   *  CURRENT-session API (background/poller only): resolves the CURRENT live
   *  record for `sub` with NO generation check. Authenticated (token-facing)
   *  callers MUST use `getContextForSession` instead — a `sub`-only read on a
   *  token path is a TOCTOU (guard validates A, replacement B is then used). */
  async getContext(sub?: string): Promise<{ cookie: string; sesskey: string }> {
    return this.getContextForCurrent(sub);
  }

  /**
   * CURRENT-session read for background flows (poller) that own no JWT:
   * the current live record, whatever its generation. Never call from an
   * authenticated controller/service path.
   */
  async getContextForCurrent(sub?: string): Promise<{ cookie: string; sesskey: string }> {
    const session = sub ? await this.sessionStore?.get(sub) : null;
    if (!session?.kulonCookie) {
      throw new StaleUpstreamError(
        'Kulon',
        'no-cookie',
        'Kulon session belum ada. Silakan login ulang via SSO',
      );
    }
    // The live record scopes the read through the SAME scoped entry as the
    // token path: same generation means the same cookie material, so sharing
    // is safe and saves a duplicate /my/ probe. A legacy record without a
    // generation cannot scope — stale, forcing a clean re-login.
    const ref = sub ? currentRefForSession(sub, session) : null;
    if (!ref) {
      throw new StaleUpstreamError(
        'Kulon',
        'no-cookie',
        'Kulon session belum ada. Silakan login ulang via SSO',
      );
    }
    const key = cacheKeyForSession(ref, 'kulon', 'sesskey', sesskeyFingerprint(session.kulonCookie));
    return {
      cookie: session.kulonCookie,
      sesskey: await this.resolveSesskey(key, session.kulonCookie),
    };
  }

  /**
   * Token-facing read: resolves the session ONLY if the live record still
   * carries the token's exact `sessionGeneration` (atomic snapshot via
   * `getIfGeneration`). A replacement between JwtAuthGuard and this read is
   * 401 SESSION_DEAD — B's cookies are never returned to an A-token, and no
   * upstream fetch is attempted (no B leak, no stale-A use).
   */
  async getContextForSession(ref: SessionRef): Promise<{ cookie: string; sesskey: string }> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.sessionStore?.getIfGeneration(ref.sub, ref.sessionGeneration) ?? null;
    if (!session?.kulonCookie || !isSessionGeneration(session.sessionGeneration)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (session.sessionGeneration !== ref.sessionGeneration) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Generation-scoped sesskey entry: an A flight/entry is never joined or
    // reused by a B generation, even when the cookie material is identical.
    const key = cacheKeyForSession(ref, 'kulon', 'sesskey', sesskeyFingerprint(session.kulonCookie));
    return { cookie: session.kulonCookie, sesskey: await this.resolveSesskey(key, session.kulonCookie) };
  }

  /** Sesskey resolve shared by both reads: scoped cache + scoped single-flight. */
  private async resolveSesskey(key: string, cookie: string): Promise<string> {
    if (!this.cache) {
      return this.fetchSesskeyOrThrow(cookie);
    }
    const cached = await this.cache.get<string>(key);
    if (cached) return cached;
    // The flight slot IS the cache key: one in-flight slot per generation
    // (or per current namespace) — A can never join B's /my/ fetch.
    const sesskey = await this.sesskeyFlight.run(key, () =>
      this.fetchSesskeyOrThrow(cookie),
    );
    if (this.cache)
      await this.cache.set(key, sesskey, CachePolicy.KULON_SESSKEY);
    return sesskey;
  }

  /**
   * Sesskey needed for every AJAX call; typed errors on the way:
   * redirect loop / login page → stale 401, other network failure → 502
   * BAD_GATEWAY, non-ok status → "gangguan" 401.
   */
  async fetchSesskeyOrThrow(cookie: string): Promise<string> {
    try {
      return await timedFetch(
        this.runtime,
        KULON_ROUTE_CONTEXTS.sesskey,
        `${KULON_BASE_URL}/my/`,
        { headers: { Cookie: cookie }, redirect: 'follow' },
        async (res): Promise<UpstreamAttemptResult<string>> => {
          if (!res.ok) {
            // Keep the historical response-less StaleUpstreamError: even a
            // 5xx sesskey response is an outward 401 compatibility shape.
            return httpErrorResult(
              new StaleUpstreamError(
                'Kulon',
                'http-not-ok',
                'Kulon mengalami gangguan. Silakan login ulang via SSO',
              ),
              res.status,
            );
          }
          if (isLoginRedirect(res.url)) {
            return staleResult(
              new StaleUpstreamError('Kulon', 'login-redirect'),
              'login-redirect',
              res.status,
            );
          }
          const html = await res.text();
          try {
            return {
              ok: true,
              value: parseSesskey(html),
              outcome: 'ok',
              status: res.status,
            };
          } catch (error) {
            if (!hasSesskeyMarker(html)) {
              return staleResult(
                new StaleUpstreamError('Kulon', 'login-redirect'),
                'login-redirect',
                res.status,
              );
            }
            throw error;
          }
        },
      );
    } catch (error) {
      const transportReason = getTimedFetchTransportReason(error);
      if (transportReason === 'fetch-threw') {
        const gateway = new HttpException(
          { message: 'Gagal terhubung ke Kulon', detail: 'BAD_GATEWAY' },
          HttpStatus.BAD_GATEWAY,
        ) as HttpException & { reason?: string };
        gateway.reason = transportReason;
        throw gateway;
      }
      if (transportReason === 'redirect-loop') {
        throw new StaleUpstreamError('Kulon', transportReason);
      }
      throw error;
    }
  }

  /** Kulon's session-based AJAX API with shared stale/transient classification. */
  async ajax(
    sessionCookie: string,
    sesskey: string,
    methodname: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await timedFetch(
        this.runtime,
        KULON_ROUTE_CONTEXTS.ajax,
        `${KULON_BASE_URL}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
          },
          body: JSON.stringify([{ index: 0, methodname, args }]),
        },
        async (res): Promise<UpstreamAttemptResult<unknown>> => {
        if (!res.ok) {
          return httpErrorResult(
            new StaleUpstreamError('Kulon', 'http-not-ok', undefined, res),
            res.status,
          );
        }
        if (isLoginRedirect(res.url)) {
          return staleResult(
            new StaleUpstreamError('Kulon', 'login-redirect', undefined, res),
            'login-redirect',
            res.status,
          );
        }
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          const reason = /text\/html/i.test(res.headers?.get?.('content-type') ?? '')
            ? 'html-content-type'
            : 'malformed-json';
          return {
            ok: false,
            error: new StaleUpstreamError('Kulon', reason, undefined, res),
            outcome: 'parse_error',
            reason,
            status: res.status,
          };
        }
        const firstValue = Array.isArray(data) ? data[0] : undefined;
        const first =
          typeof firstValue === 'object' && firstValue !== null
            ? (firstValue as {
                error?: boolean;
                exception?: { message?: string };
                data?: unknown;
              })
            : undefined;
        if (!first) {
          return staleResult(
            new StaleUpstreamError('Kulon', 'api-endpoint'),
            'api-endpoint',
            res.status,
          );
        }
        if (first.error) {
          return staleResult(
            new StaleUpstreamError(
              'Kulon',
              'api-endpoint',
              `Kulon method ${methodname} error: ${first.exception?.message ?? 'unknown'}`,
            ),
            'api-endpoint',
            res.status,
          );
        }
        return { ok: true, value: first.data, outcome: 'ok', status: res.status };
        },
      );
    } catch (error) {
      const transportReason = getTimedFetchTransportReason(error);
      if (transportReason) {
        throw new StaleUpstreamError('Kulon', transportReason);
      }
      throw error;
    }
  }
}
