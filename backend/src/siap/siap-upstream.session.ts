import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  getTimedFetchTransportReason,
  isLoginRedirect,
  StaleUpstreamError,
  timedFetch,
  UpstreamFetchOpts,
  UpstreamSessionCheck,
  upstreamFetchJson,
  upstreamFetchText,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
} from '../upstream/upstream-fetch';
import { DataCache } from '../cache/data-cache';
import { CachePolicy } from '../cache/cache-policy';
import { SessionStore, SessionRef, isSessionRef } from '../session/session-store';
import {
  cacheKeyForSession,
  currentRefForSession,
  flightKeyForSession,
} from '../session/session-scope';
import { isSessionGeneration } from '../session/session-contract';
import { createKeyedSingleFlight } from '../common/single-flight';
import { SiapApiUpstream } from './siap-api';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';

export const SIAP_BASE_URL = 'https://siap.undip.ac.id';

/** Probe path: the dashboard is SIAP's session-validity page (spike §2). */
const SIAP_PROBE_PATH = '/pages/mhs/dashboard';
/** Present on the authenticated dashboard, absent on a login page. */
export const SIAP_AUTH_MARKER = 'tabmhs_profile';

const SIAP_PROFILE_PAGE: UpstreamRouteContext = {
  service: 'siap',
  operation: 'profile_page',
  route: 'GET /pages/mhs/dashboard',
};
const SIAP_ATTENDANCE_PAGE: UpstreamRouteContext = {
  service: 'siap',
  operation: 'attendance_page',
  route: 'POST /jadwal_mahasiswa/mhs/jadwal/get_absen',
};
const SIAP_NOTIFICATION_ACTION: UpstreamRouteContext = {
  service: 'siap',
  operation: 'notification_action',
  route: 'POST /pages/mhs/dashboard/ajax/unread',
};
const SIAP_QR_PRESENCE: UpstreamRouteContext = {
  service: 'siap',
  operation: 'qr_presence',
  route: 'POST /master_perkuliahan/mhs/absensi/process/',
};

function pageContext(url: string, init: RequestInit | undefined): UpstreamRouteContext {
  const pathname = new URL(url).pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && pathname === '/pages/mhs/dashboard') return SIAP_PROFILE_PAGE;
  if (method === 'POST' && pathname === '/jadwal_mahasiswa/mhs/jadwal/get_absen') {
    return SIAP_ATTENDANCE_PAGE;
  }
  if (method === 'POST' && pathname === '/pages/mhs/dashboard/ajax/unread') {
    return SIAP_NOTIFICATION_ACTION;
  }
  throw new TypeError('Invalid SIAP page endpoint');
}

/** Identity payload (no token) cached/fetched independently of the API token. */
export interface SiapIdentity {
  emailSso: string;
  nim: string;
}

/** Resolved SIAP context handed to the service: identity + API token. */
export interface SiapSessionContext {
  emailSso: string;
  nim: string;
  token: string;
}

/** Scrape fallback shape (used when the session store lacks emailSso). */
export type SiapIdentityScraper = (siapCookie: string) => Promise<{
  nim: string;
  emailSso: string;
}>;

/**
 * SIAP's one session seam: validity probe + authenticated fetch + stale
 * classification. Everything that used to be `siapFetch` / `siapFetchJson` /
 * `stale()` scattered inside SiapService lives here; parsing stays in the
 * service. Any fetch failure, non-ok response, login redirect, or HTML-in-
 * place-of-JSON body maps to the uniform StaleUpstreamError (401).
 */
@Injectable()
export class SiapUpstreamSession {
  private readonly cache?: DataCache;
  private readonly apiUpstream?: SiapApiUpstream;
  private scrapeIdentity?: SiapIdentityScraper;
  private readonly runtime: TelemetryRuntime;
  /** Keyed flights: one in-flight slot per user (no cross-user contention). */
  private readonly identityFlight = createKeyedSingleFlight<SiapIdentity>();
  private readonly tokenFlight = createKeyedSingleFlight<string>();

  constructor(
    @Inject(SessionStore) sessionStore: SessionStore,
    @Optional() cache?: DataCache,
    @Optional() apiUpstream?: SiapApiUpstream,
    @Optional() scrapeIdentity?: SiapIdentityScraper,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.cache = cache;
    this.apiUpstream = apiUpstream;
    this.scrapeIdentity = scrapeIdentity;
    this.runtime = runtime ?? createNoopTelemetryRuntime();
    this.store = sessionStore;
  }

  /** Session store (mandatory DI; see session-store.ts DI rule). */
  readonly store: SessionStore;

  /** Single source of truth for SIAP session validity (no-throw probe). */
  async checkSessionValid(cookie: string): Promise<UpstreamSessionCheck> {
    if (!cookie) return { valid: false, reason: 'no-cookie' };
    const url = `${SIAP_BASE_URL}${SIAP_PROBE_PATH}`;
    try {
      await timedFetch<void>(
        this.runtime,
        SIAP_SESSION_PROBE_CONTEXT,
        url,
        { headers: { Cookie: cookie }, redirect: 'follow' },
        async (res): Promise<UpstreamAttemptResult<void>> => {
          if (!res.ok) {
            return {
              ok: false,
              error: new StaleUpstreamError('Siap', 'http-not-ok', undefined, res),
              outcome: 'http_error',
              reason: 'http-not-ok',
              status: res.status,
            };
          }
          if (isLoginRedirect(res.url)) {
            return {
              ok: false,
              error: new StaleUpstreamError('Siap', 'login-redirect', undefined, res),
              outcome: 'stale',
              reason: 'login-redirect',
              status: res.status,
            };
          }
          const html = await res.text();
          if (!html.includes(SIAP_AUTH_MARKER)) {
            return {
              ok: false,
              error: new StaleUpstreamError('Siap', 'login-redirect', undefined, res),
              outcome: 'stale',
              reason: 'login-redirect',
              status: res.status,
            };
          }
          return { ok: true, value: undefined, outcome: 'ok', status: res.status };
        },
      );
      return { valid: true, reason: 'ok' };
    } catch {
      return { valid: false, reason: 'stale' };
    }
  }

  /** Identity + token for a user. Identity: session store → cache (24 h) →
   *  scrape fallback (cached, NOT written back to the session store). Token:
   *  cache (10 min) → mint (single-flight). Missing siapCookie -> stale 401.
   *  CURRENT-session API (background/poller only): resolves the CURRENT live
   *  record for `sub` with NO generation check. Authenticated (token-facing)
   *  callers MUST use `getContextForSession` instead. */
  async getContext(sub?: string): Promise<SiapSessionContext> {
    return this.getContextForCurrent(sub);
  }

  /** CURRENT-session read for background flows (poller) that own no JWT. */
  async getContextForCurrent(sub?: string): Promise<SiapSessionContext> {
    const ref = await this.getCurrentSessionRef(sub);
    return this.getContextForSession(ref);
  }

  /** Resolve the live generation for a background caller before token work. */
  async getCurrentSessionRef(sub?: string): Promise<SessionRef> {
    const session = sub ? await this.store.get(sub) : null;
    const ref = sub && session?.siapCookie ? currentRefForSession(sub, session) : null;
    if (!ref) {
      throw new StaleUpstreamError(
        'Siap',
        'no-cookie',
        'SIAP session belum ada. Silakan login ulang via SSO',
      );
    }
    return ref;
  }

  /**
   * Token-facing read: identity + token ONLY if the live record still carries
   * the token's exact `sessionGeneration` (atomic snapshot via
   * `getIfGeneration`). A B-replacement between JwtAuthGuard and this read is
   * 401 SESSION_DEAD — B's token/identity are never returned to an A-token,
   * and no mint/fetch is attempted with B material.
   */
  async getContextForSession(ref: SessionRef): Promise<SiapSessionContext> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.store.getIfGeneration(ref.sub, ref.sessionGeneration);
    if (!session?.siapCookie || !isSessionGeneration((session as { sessionGeneration?: unknown }).sessionGeneration)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if ((session as { sessionGeneration: string }).sessionGeneration !== ref.sessionGeneration) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.resolveScoped(ref, session);
  }

  /**
   * Token-facing SIAP page cookie: the exact-generation record's siapCookie.
   * Single seam for ALL cookie-path service methods (kehadiran, unread) so no
   * duplicate `sessionStore.get` lives in SiapService. Mismatch/dead →
   * 401 SESSION_DEAD, never B's cookie.
   */
  async getCookieForSession(ref: SessionRef): Promise<string> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.store.getIfGeneration(ref.sub, ref.sessionGeneration);
    const cookie = (session as { siapCookie?: unknown } | null)?.siapCookie;
    const generation = (session as { sessionGeneration?: unknown } | null)?.sessionGeneration;
    if (typeof cookie !== 'string' || !cookie || !isSessionGeneration(generation)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (generation !== ref.sessionGeneration) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return cookie;
  }

  /** Shared identity+token resolve (generation-scoped cache + single-flight).
   *  Both the token path (exact-generation snapshot) and the current path
   *  (live-record ref) funnel through here: one implementation, one scoping
   *  rule — an A-token can neither join B's flights nor read A's primed
   *  entries after a B-replacement. */
  private async resolveScoped(
    ref: SessionRef,
    session: { identity?: string; emailSso?: string; siapCookie?: string } | null,
  ): Promise<SiapSessionContext> {
    if (!this.cache) {
      // No cache path: resolve directly (identity from store, scrape fallback).
      const identity = await this.resolveIdentity(ref.sub, session);
      const token = await this.mintFresh(identity.emailSso, identity.nim);
      return { ...identity, token };
    }
    const identityKey = cacheKeyForSession(ref, 'siap', 'identity');
    const identity = await this.identityFlight.run(
      flightKeyForSession(ref, 'siap.identity'),
      async () => {
        const cached = await this.cache!.get<SiapIdentity>(identityKey);
        if (cached) {
          return cached;
        }
        const resolved = await this.resolveIdentity(ref.sub, session);
        await this.cache!.set(identityKey, resolved, CachePolicy.SIAP_IDENTITY);
        return resolved;
      },
    );
    const tokenKey = cacheKeyForSession(ref, 'siap', 'token');
    const token = await this.tokenFlight.run(
      flightKeyForSession(ref, 'siap.token'),
      async () => {
        const cached = await this.cache!.get<string>(tokenKey);
        if (cached) {
          return cached;
        }
        const fresh = await this.mintFresh(identity.emailSso, identity.nim);
        await this.cache!.set(tokenKey, fresh, CachePolicy.SIAP_TOKEN);
        return fresh;
      },
    );
    return { ...identity, token };
  }

  /** Identity = nim + emailSso, resolved store-first, scrape fallback last.
   *  Never writes the scraped emailSso back to the session store (the session
   *  stays as-captured; the cache owns the enriched value). */
  private async resolveIdentity(
    sub: string | undefined,
    session: { identity?: string; emailSso?: string; siapCookie?: string } | null,
  ): Promise<SiapIdentity> {
    const nim = session?.identity ?? sub ?? '';
    let emailSso = session?.emailSso ?? '';
    if (!emailSso && this.scrapeIdentity && session?.siapCookie) {
      const scraped = await this.scrapeIdentity(session.siapCookie);
      emailSso = scraped.emailSso ?? '';
    }
    if (!emailSso) {
      throw new StaleUpstreamError(
        'Siap',
        'no-emailSso',
        'Email SSO tidak tersedia. Silakan login ulang via SSO',
      );
    }
    return { nim, emailSso };
  }

  /** Mint a fresh SIAP API token (no cache read/write here — callers cache). */
  private async mintFresh(emailSso: string, nim: string): Promise<string> {
    if (!this.apiUpstream) {
      throw new StaleUpstreamError('Siap', 'no-api-upstream');
    }
    const { token } = await this.apiUpstream.mintToken(emailSso, nim);
    return token;
  }

  /** Wire the scrape fallback after construction (SiapService calls this in its
   *  constructor — it owns fetchProfile; avoids circular DI via SiapModule). */
  setScrapeIdentity(fn: SiapIdentityScraper): void {
    this.scrapeIdentity = fn;
  }

  /** Authenticated SIAP page fetch → body text, or throws stale 401. */
  async fetchText(
    url: string,
    init?: RequestInit,
    opts?: UpstreamFetchOpts,
  ): Promise<string> {
    return upstreamFetchText(
      this.runtime,
      pageContext(url, init),
      url,
      init,
      this.logged(opts),
    );
  }

  /** Authenticated SIAP AJAX/JSON fetch → parsed JSON, or throws stale 401. */
  async fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    return upstreamFetchJson<T>(
      this.runtime,
      pageContext(url, init),
      url,
      init,
      this.logged(),
    );
  }

  /**
   * POST-style JSON endpoint where an upstream 4xx/5xx body must PASS THROUGH:
   * a genuine invalid-QR-token error is not a stale session. Only a network
   * failure, a login redirect on an otherwise-ok response, or a non-JSON body
   * maps to stale.
   */
  async fetchJsonAllowingHttpErrors<T = unknown>(
    url: string,
    init?: RequestInit,
  ): Promise<{ httpOk: boolean; status: number; body: T }> {
    const context = SIAP_QR_PRESENCE;
    const passedThrough = {
      httpOk: false,
      status: 0,
      body: undefined as T,
    };
    const passThroughError = { passedThrough };
    try {
      return await timedFetch(
        this.runtime,
        context,
        url,
        init,
        async (res): Promise<UpstreamAttemptResult<{ httpOk: boolean; status: number; body: T }>> => {
          if (res.ok && isLoginRedirect(res.url)) {
            return {
              ok: false,
              error: new StaleUpstreamError('Siap', 'login-redirect', undefined, res),
              outcome: 'stale',
              reason: 'login-redirect',
              status: res.status,
            };
          }
          let body: T;
          try {
            body = (await res.json()) as T;
          } catch {
            return {
              ok: false,
              error: new StaleUpstreamError('Siap', 'non-json-process', undefined, res),
              outcome: 'parse_error',
              reason: 'non-json-process',
              status: res.status,
            };
          }
          if (!res.ok) {
            passedThrough.httpOk = false;
            passedThrough.status = res.status;
            passedThrough.body = body;
            return {
              ok: false,
              error: passThroughError,
              outcome: 'http_error',
              reason: 'http-not-ok',
              status: res.status,
            };
          }
          return {
            ok: true,
            value: { httpOk: true, status: res.status, body },
            outcome: 'ok',
            status: res.status,
          };
        },
      );
    } catch (error) {
      if (error === passThroughError) return passedThrough;
      if (error instanceof StaleUpstreamError) throw error;
      if (getTimedFetchTransportReason(error)) {
        throw new StaleUpstreamError('Siap', 'fetch-threw');
      }
      throw error;
    }
  }

  /** Preserve the compatibility stale hook without exposing upstream evidence. */
  private logged(extra?: UpstreamFetchOpts): UpstreamFetchOpts {
    return {
      ...extra,
      onStale: (reason, res, evidence) => extra?.onStale?.(reason, res, evidence),
    };
  }
}

const SIAP_SESSION_PROBE_CONTEXT: UpstreamRouteContext = {
  service: 'siap',
  operation: 'session_probe',
  route: 'GET /pages/mhs/dashboard',
};
