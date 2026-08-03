import { Injectable } from '@nestjs/common';

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

  constructor(config: MicrosoftConfig) {
    this.config = config;
    this.authorizeUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`;
  }

  getAuthUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email offline_access',
      response_mode: 'query',
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async handleCallback(
    code: string,
  ): Promise<{ accessToken: string; sessionCookies: string }> {
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