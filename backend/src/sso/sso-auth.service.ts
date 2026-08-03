import { Injectable, Logger } from '@nestjs/common';
import { SSOTicketService } from './ticket.service';

@Injectable()
export class SSOAuthService {
  private readonly logger = new Logger(SSOAuthService.name);

  constructor(private readonly ticketService: SSOTicketService) {}

  async getCsrfToken(baseUrl: string): Promise<string> {
    const res = await fetch(`${baseUrl}/auth/user/login`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const match = html.match(/name="csrf_sso"\s+value="([^"]+)"/);
    if (!match) throw new Error('CSRF token not found on login page');
    return match[1];
  }

  async login(
    baseUrl: string,
    identity: string,
    password: string,
  ): Promise<{ cookie: string; redirectUrl: string }> {
    const csrf = await this.getCsrfToken(baseUrl);
    const body = new URLSearchParams({ csrf_sso: csrf, identity, password });
    const res = await fetch(`${baseUrl}/sso/auth_v2`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
      },
      body: body.toString(),
    });
    const rawCookie = res.headers.get('set-cookie') ?? '';
    const location = res.headers.get('location') ?? '';
    if (!rawCookie.includes('ci_session_sso')) {
      throw new Error('Login failed: no session cookie returned');
    }
    return { cookie: rawCookie, redirectUrl: location };
  }

  newTicket(): string {
    return this.ticketService.generateTicket();
  }
}