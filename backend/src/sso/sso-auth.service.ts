import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SSOTicketService } from './ticket.service';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import {
  timedFetch,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
} from '../upstream/upstream-fetch';

const SSO_LOGIN_PAGE: UpstreamRouteContext = {
  service: 'sso',
  operation: 'login_page',
  route: 'GET /auth/user/login',
};
const SSO_SESSION_EXCHANGE: UpstreamRouteContext = {
  service: 'sso',
  operation: 'session_exchange',
  route: 'POST /sso/auth_v2',
};

@Injectable()
export class SSOAuthService {
  private readonly logger = new Logger(SSOAuthService.name);
  private readonly runtime: TelemetryRuntime;

  constructor(
    private readonly ticketService: SSOTicketService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  async getCsrfToken(baseUrl: string): Promise<string> {
    return (await this.loginPageWithCookie(baseUrl)).csrf;
  }

  /**
   * Fetch the login page once and return both the CSRF token and the session
   * cookie it sets. CodeIgniter binds the CSRF token to its session cookie, so
   * `login` must send that cookie alongside the token in the POST (B7).
   */
  private async loginPageWithCookie(
    baseUrl: string,
  ): Promise<{ csrf: string; cookie: string }> {
    return timedFetch(
      this.runtime,
      SSO_LOGIN_PAGE,
      `${baseUrl}/auth/user/login`,
      {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      async (res): Promise<UpstreamAttemptResult<{ csrf: string; cookie: string }>> => {
        if (!res.ok) {
          return {
            ok: false,
            error: new Error(`SSO login page failed: ${res.status}`),
            outcome: 'http_error',
            reason: 'http-not-ok',
            status: res.status,
          };
        }
        let html: string;
        try {
          html = await res.text();
        } catch {
          return {
            ok: false,
            error: new Error('CSRF token not found on login page'),
            outcome: 'parse_error',
            reason: 'unknown',
            status: res.status,
          };
        }
        const match = html.match(/name="csrf_sso"\s+value="([^"]+)"/);
        if (!match) {
          return {
            ok: false,
            error: new Error('CSRF token not found on login page'),
            outcome: 'parse_error',
            reason: 'unknown',
            status: res.status,
          };
        }
        return {
          ok: true,
          value: { csrf: match[1], cookie: this.parseSetCookie(res.headers.get('set-cookie')) },
          outcome: 'ok',
          status: res.status,
        };
      },
    );
  }

  /**
   * Convert a raw `Set-Cookie`/`Set-Cookie2` value into a clean `name=value;
   * ...` request cookie string. Strips response-only attributes (Path, HttpOnly,
   * Secure, Expires, Max-Age, SameSite, Domain) and merges multiple entries.
   * A raw Set-Cookie string contains garbage when reused as a `Cookie:` header.
   */
  private parseSetCookie(raw: string | null): string {
    if (!raw) return '';
    return raw
      .split(',')
      .map((part) => part.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  async login(
    baseUrl: string,
    identity: string,
    password: string,
  ): Promise<{ cookie: string; redirectUrl: string }> {
    const { csrf, cookie: preLoginCookie } = await this.loginPageWithCookie(baseUrl);
    const body = new URLSearchParams({ csrf_sso: csrf, identity, password });
    return timedFetch(
      this.runtime,
      SSO_SESSION_EXCHANGE,
      `${baseUrl}/sso/auth_v2`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          // Send the session cookie set by the login-page GET (CSRF binding).
          Cookie: preLoginCookie,
        },
        body: body.toString(),
      },
      async (res): Promise<UpstreamAttemptResult<{ cookie: string; redirectUrl: string }>> => {
        const rawCookie = res.headers.get('set-cookie') ?? '';
        if (!rawCookie.includes('ci_session_sso')) {
          return {
            ok: false,
            error: new Error('Login failed: no session cookie returned'),
            outcome: 'stale',
            reason: 'no-cookie',
            status: res.status,
          };
        }
        return {
          ok: true,
          value: {
            cookie: this.parseSetCookie(rawCookie),
            redirectUrl: res.headers.get('location') ?? '',
          },
          outcome: 'ok',
          // Manual redirects with the session cookie are a successful exchange.
          status: res.status,
        };
      },
    );
  }

  newTicket(): string {
    return this.ticketService.generateTicket();
  }
}
