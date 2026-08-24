import { Injectable, Logger } from '@nestjs/common';
import {
  isLoginRedirect,
  probeUpstreamSession,
  StaleUpstreamError,
  UpstreamFetchOpts,
  UpstreamSessionCheck,
  upstreamFetchJson,
  upstreamFetchText,
} from '../upstream/upstream-fetch';

export const SIAP_BASE_URL = 'https://siap.undip.ac.id';

/** Probe path: the dashboard is SIAP's session-validity page (spike §2). */
const SIAP_PROBE_PATH = '/pages/mhs/dashboard';
/** Present on the authenticated dashboard, absent on a login page. */
export const SIAP_AUTH_MARKER = 'tabmhs_profile';

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
