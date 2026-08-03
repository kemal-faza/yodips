import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface MicrosoftConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

@Injectable()
export class MicrosoftAuthService {
  private readonly config: MicrosoftConfig;
  private readonly authorizeUrl: string;
  /** In-memory map of issued `state` values -> expiry (single-user hint). */
  private readonly pendingStates = new Map<string, number>();

  constructor(config: MicrosoftConfig) {
    this.config = config;
    this.authorizeUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`;
  }

  /**
   * Generate a fresh `state` value used to bind the authorize request to its
   * callback (prevents login CSRF). Rotates out any expired entries.
   */
  private issueState(): string {
    const now = Date.now();
    for (const [k, exp] of this.pendingStates) {
      if (exp < now) this.pendingStates.delete(k);
    }
    const state = randomBytes(24).toString('base64url');
    this.pendingStates.set(state, now + 10 * 60_000); // 10 min validity
    return state;
  }

  getAuthUrl(): string {
    const state = this.issueState();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email offline_access',
      response_mode: 'query',
      state,
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state?: string,
  ): Promise<{ accessToken: string; sessionCookies: string }> {
    if (!state || !this.pendingStates.has(state)) {
      throw new Error('Invalid or missing OIDC state (CSRF protection)');
    }
    this.pendingStates.delete(state);

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email offline_access',
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed: ${res.status}`);
    }
    const data = await res.json();
    const rawCookie = res.headers.get('set-cookie') ?? '';
    return { accessToken: data.access_token, sessionCookies: rawCookie };
  }
}