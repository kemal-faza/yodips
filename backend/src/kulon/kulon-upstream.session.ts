import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  classifyUpstreamFetch,
  probeUpstreamSession,
  StaleUpstreamError,
  UpstreamSessionCheck,
} from '../upstream/upstream-fetch';
import { DataCache } from '../cache/data-cache';
import { SessionStore } from '../session/session-store';
import { createKeyedSingleFlight } from '../common/single-flight';

export const KULON_BASE_URL = 'https://kulon2.undip.ac.id';
const SESSKEY_TTL_MS = 5 * 60_000;
const SESSKEY_FP_LEN = 16;

/** Cache key for a user's sesskey, fingerprinted by the session cookie so a
 *  re-login (new cookie) is an automatic cache miss. */
export function sesskeyCacheKey(sub: string, cookie: string): string {
  const fp = createHash('sha256').update(cookie).digest('hex').slice(0, SESSKEY_FP_LEN);
  return `${sub}:kulon:sesskey:${fp}`;
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
  private readonly logger = new Logger(KulonUpstreamSession.name);
  private readonly sessionStore?: SessionStore;
  private readonly cache?: DataCache;
  private readonly sesskeyFlight = createKeyedSingleFlight<string>();

  constructor(
    @Optional() sessionStore?: SessionStore,
    @Optional() cache?: DataCache,
  ) {
    this.sessionStore = sessionStore;
    this.cache = cache;
  }

  /**
   * Single source of truth for Kulon session validity. A real session makes
   * GET /my/ return a page containing a `sesskey`; stale sessions redirect to
   * a Moodle login page / Microsoft OIDC or loop redirects — all map to
   * `stale` without throwing.
   */
  checkSessionValid(cookie: string): Promise<UpstreamSessionCheck> {
    return probeUpstreamSession({
      url: `${KULON_BASE_URL}/my/`,
      cookie,
      service: 'Kulon',
      isAuthenticatedPage: (_finalUrl, html) => hasSesskeyMarker(html),
      onEvidence: (evidence) =>
        this.logger.warn(`Kulon session probe: ${evidence}`),
    });
  }

  /** Cookie + cached sesskey for a user. Cookie is ALWAYS read from the session
   *  store (never cached); sesskey is cached (fingerprint key, 5 min TTL) with
   *  single-flight. Missing session -> typed stale 401. */
  async getContext(sub?: string): Promise<{ cookie: string; sesskey: string }> {
    const session = sub ? await this.sessionStore?.get(sub) : null;
    if (!session?.kulonCookie) {
      throw new StaleUpstreamError(
        'Kulon',
        'no-cookie',
        'Kulon session belum ada. Silakan login ulang via SSO',
      );
    }
    const cookie = session.kulonCookie;
    if (!sub || !this.cache) {
      const sesskey = await this.fetchSesskeyOrThrow(cookie);
      return { cookie, sesskey };
    }
    const key = sesskeyCacheKey(sub, cookie);
    const cached = await this.cache.get<string>(key);
    if (cached) {
      this.logger.debug(`[upstream] kulon sesskey sub=${sub} hit=true`);
      return { cookie, sesskey: cached };
    }
    this.logger.debug(`[upstream] kulon sesskey sub=${sub} hit=false`);
    const sesskey = await this.sesskeyFlight.run(key, () => this.fetchSesskeyOrThrow(cookie));
    if (this.cache) await this.cache.set(key, sesskey, SESSKEY_TTL_MS);
    return { cookie, sesskey };
  }

  /**
   * Sesskey needed for every AJAX call; typed errors on the way:
   * redirect loop / login page → stale 401, other network failure → 502
   * BAD_GATEWAY, non-ok status → "gangguan" 401.
   */
  async fetchSesskeyOrThrow(cookie: string): Promise<string> {
    const outcome = await classifyUpstreamFetch(`${KULON_BASE_URL}/my/`, {
      headers: { Cookie: cookie },
      redirect: 'follow',
    });
    switch (outcome.kind) {
      case 'gateway':
        this.logger.error(
          `Kulon connection failed: ${outcome.networkMessage}`,
        );
        throw new HttpException(
          { message: 'Gagal terhubung ke Kulon', detail: 'BAD_GATEWAY' },
          HttpStatus.BAD_GATEWAY,
        );
      case 'stale':
        throw outcome.reason === 'http-not-ok'
          ? new StaleUpstreamError(
              'Kulon',
              outcome.reason,
              'Kulon mengalami gangguan. Silakan login ulang via SSO',
            )
          : new StaleUpstreamError('Kulon', outcome.reason);
      case 'ok': {
        const html = await outcome.res.text();
        try {
          return parseSesskey(html);
        } catch (e) {
          if (!hasSesskeyMarker(html)) {
            throw new StaleUpstreamError('Kulon', 'login-redirect');
          }
          throw e;
        }
      }
    }
  }

  /**
   * Kulon session-based AJAX API (`lib/ajax/service.php`). Transport only:
   * throws plain Errors exactly as before so callers' catch-all fallbacks
   * (e.g. JSON-state → HTML scrape) keep behaving identically.
   */
  async ajax(
    sessionCookie: string,
    sesskey: string,
    methodname: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `${KULON_BASE_URL}/lib/ajax/service.php?sesskey=${sesskey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      },
    );
    if (!res.ok) throw new Error(`Kulon AJAX failed: ${res.status}`);
    const data = await res.json();
    const first = (data as any[])[0];
    if (first?.error) {
      throw new Error(
        `Kulon method ${methodname} error: ${first.exception?.message ?? 'unknown'}`,
      );
    }
    this.logger.debug(`[upstream] kulon ajax ${methodname} sub=n/a`);
    return first?.data;
  }
}
