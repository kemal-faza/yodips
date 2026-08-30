import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  isLoginRedirect,
  probeUpstreamSession,
  StaleUpstreamError,
  UpstreamFetchOpts,
  UpstreamSessionCheck,
  upstreamFetchJson,
  upstreamFetchText,
} from '../upstream/upstream-fetch';
import { DataCache } from '../cache/data-cache';
import { SessionStore } from '../session/session-store';
import { createKeyedSingleFlight } from '../common/single-flight';
import { SiapApiUpstream } from './siap-api';

export const SIAP_BASE_URL = 'https://siap.undip.ac.id';

/** Probe path: the dashboard is SIAP's session-validity page (spike §2). */
const SIAP_PROBE_PATH = '/pages/mhs/dashboard';
/** Present on the authenticated dashboard, absent on a login page. */
export const SIAP_AUTH_MARKER = 'tabmhs_profile';

/** Identity cache TTL: 24 h — email/nim are stable for a session. */
const IDENTITY_TTL_MS = 24 * 60 * 60_000;
/** Token cache TTL: 10 min — minted token is single-use-ish, keep it short. */
const TOKEN_TTL_MS = 10 * 60_000;

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
  private readonly logger = new Logger(SiapUpstreamSession.name);
  private readonly sessionStore?: SessionStore;
  private readonly cache?: DataCache;
  private readonly apiUpstream?: SiapApiUpstream;
  private scrapeIdentity?: SiapIdentityScraper;
  /** Keyed flights: one in-flight slot per user (no cross-user contention). */
  private readonly identityFlight = createKeyedSingleFlight<SiapIdentity>();
  private readonly tokenFlight = createKeyedSingleFlight<string>();

  constructor(
    @Optional() sessionStore?: SessionStore,
    @Optional() cache?: DataCache,
    @Optional() apiUpstream?: SiapApiUpstream,
    @Optional() scrapeIdentity?: SiapIdentityScraper,
  ) {
    this.sessionStore = sessionStore;
    this.cache = cache;
    this.apiUpstream = apiUpstream;
    this.scrapeIdentity = scrapeIdentity;
  }

  /** Single source of truth for SIAP session validity (no-throw probe). */
  checkSessionValid(cookie: string): Promise<UpstreamSessionCheck> {
    return probeUpstreamSession({
      url: `${SIAP_BASE_URL}${SIAP_PROBE_PATH}`,
      cookie,
      service: 'Siap',
      isAuthenticatedPage: (finalUrl, html) =>
        !/\/login\//i.test(finalUrl) && html.includes(SIAP_AUTH_MARKER),
    });
  }

  /** Identity + token for a user. Identity: session store → cache (24 h) →
   *  scrape fallback (cached, NOT written back to the session store). Token:
   *  cache (10 min) → mint (single-flight). Missing siapCookie -> stale 401. */
  async getContext(sub?: string): Promise<SiapSessionContext> {
    const session = sub ? await this.sessionStore?.get(sub) : null;
    if (!session?.siapCookie) {
      throw new StaleUpstreamError(
        'Siap',
        'no-cookie',
        'SIAP session belum ada. Silakan login ulang via SSO',
      );
    }
    if (!sub || !this.cache) {
      // No cache path: resolve directly (identity from store, scrape fallback).
      const identity = await this.resolveIdentity(sub, session);
      const token = await this.mintFresh(identity.emailSso, identity.nim);
      return { ...identity, token };
    }
    const identityKey = `${sub}:siap:identity`;
    const identity = await this.identityFlight.run(identityKey, async () => {
      const cached = await this.cache!.get<SiapIdentity>(identityKey);
      if (cached) {
        this.logger.debug(`[upstream] siap identity sub=${sub} hit=true`);
        return cached;
      }
      this.logger.debug(`[upstream] siap identity sub=${sub} hit=false`);
      const resolved = await this.resolveIdentity(sub, session);
      await this.cache!.set(identityKey, resolved, IDENTITY_TTL_MS);
      return resolved;
    });
    const tokenKey = `${sub}:siap:token`;
    const token = await this.tokenFlight.run(tokenKey, async () => {
      const cached = await this.cache!.get<string>(tokenKey);
      if (cached) {
        this.logger.debug(`[upstream] siap token sub=${sub} hit=true`);
        return cached;
      }
      this.logger.debug(`[upstream] siap token sub=${sub} hit=false`);
      const fresh = await this.mintFresh(identity.emailSso, identity.nim);
      await this.cache!.set(tokenKey, fresh, TOKEN_TTL_MS);
      return fresh;
    });
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
    this.logger.debug(`[upstream] siap mint-token sub=${nim}`);
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
    return upstreamFetchText(url, init, 'Siap', this.logged(url, opts));
  }

  /** Authenticated SIAP AJAX/JSON fetch → parsed JSON, or throws stale 401. */
  async fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    return upstreamFetchJson<T>(url, init, 'Siap', this.logged(url));
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
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      this.logStale(url, null, 'fetch-threw', (e as Error)?.message);
      throw new StaleUpstreamError('Siap', 'fetch-threw');
    }
    if (res.ok && isLoginRedirect(res.url)) {
      this.logStale(url, res, 'login-redirect');
      throw new StaleUpstreamError('Siap', 'login-redirect');
    }
    try {
      const body = (await res.json()) as T;
      return { httpOk: res.ok, status: res.status, body };
    } catch {
      // Non-JSON body: not the expected API. Treat as stale (upstream changed).
      this.logStale(url, res, 'non-json-process', `status=${res.status}`);
      throw new StaleUpstreamError('Siap', 'non-json-process');
    }
  }

  /** Merge caller opts with the adapter's stale-evidence logging. */
  private logged(url: string, extra?: UpstreamFetchOpts): UpstreamFetchOpts {
    return {
      ...extra,
      onStale: (reason, res, evidence) => {
        this.logStale(url, res, reason, evidence);
        extra?.onStale?.(reason, res, evidence);
      },
    };
  }

  /**
   * Log the evidence for a stale decision so we can distinguish a genuinely
   * expired session (login URL/body) from a valid session whose endpoint
   * returned something unexpected.
   */
  private logStale(
    url: string,
    res: Response | null,
    reason: string,
    extra?: string,
  ): void {
    const status = res?.status ?? 'n/a';
    const finalUrl = res?.url ? truncate(res.url, 120) : 'n/a';
    const contentType = res?.headers?.get('content-type') ?? 'n/a';
    this.logger.warn(
      `SIAP stale(${reason}) status=${status} finalUrl=${finalUrl} contentType=${contentType} extra=${extra ?? 'n/a'}`,
    );
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
