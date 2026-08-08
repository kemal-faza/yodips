import { Injectable, Logger } from '@nestjs/common';
import { SSOTicketService } from './ticket.service';

@Injectable()
export class SSOAuthService {
  private readonly logger = new Logger(SSOAuthService.name);

  constructor(private readonly ticketService: SSOTicketService) {}

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
    const res = await fetch(`${baseUrl}/auth/user/login`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const match = html.match(/name="csrf_sso"\s+value="([^"]+)"/);
    if (!match) throw new Error('CSRF token not found on login page');
    return { csrf: match[1], cookie: this.parseSetCookie(res.headers.get('set-cookie')) };
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
    const res = await fetch(`${baseUrl}/sso/auth_v2`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
        // Send the session cookie set by the login-page GET (CSRF binding).
        Cookie: preLoginCookie,
      },
      body: body.toString(),
    });
    const rawCookie = res.headers.get('set-cookie') ?? '';
    const location = res.headers.get('location') ?? '';
    if (!rawCookie.includes('ci_session_sso')) {
      throw new Error('Login failed: no session cookie returned');
    }
    return { cookie: this.parseSetCookie(rawCookie), redirectUrl: location };
  }

  newTicket(): string {
    return this.ticketService.generateTicket();
  }
}