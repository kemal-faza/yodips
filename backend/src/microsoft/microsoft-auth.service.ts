import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import {
  timedFetch,
  validateUpstreamAttempt,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
} from '../upstream/upstream-fetch';

export interface MicrosoftConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const MICROSOFT_TOKEN_EXCHANGE: UpstreamRouteContext = {
  service: 'microsoft',
  operation: 'token_exchange',
  route: 'POST /oauth2/v2.0/token',
};
const MAX_AUTH_CODE_LENGTH = 4096;

type TokenExchangeResult = {
  accessToken: string;
  sessionCookies: string;
};

@Injectable()
export class MicrosoftAuthService {
  private readonly config: MicrosoftConfig;
  private readonly authorizeUrl: string;
  private readonly runtime: TelemetryRuntime;
  /** In-memory map of issued `state` values -> expiry (single-user hint). */
  private readonly pendingStates = new Map<string, number>();

  private tokenExchangeUrl(): string {
    return `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
  }

  private tokenExchangeContext(): UpstreamRouteContext {
    return { ...MICROSOFT_TOKEN_EXCHANGE, tenantId: this.config.tenantId };
  }

  constructor(
    config: MicrosoftConfig,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.config = config;
    validateUpstreamAttempt(
      this.tokenExchangeContext(),
      this.tokenExchangeUrl(),
      'POST',
    );
    this.runtime = runtime ?? createNoopTelemetryRuntime();
    this.authorizeUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`;
  }

  /**
   * Generate a fresh `state` value used to bind the authorize request to its
   * callback (prevents login CSRF). Rotates out any expired entries.
   */
  private issueState(): string {
    const now = this.runtime.wallNowMs();
    for (const [k, exp] of this.pendingStates) {
      if (exp <= now) this.pendingStates.delete(k);
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

  private validateAuthorizationCode(code: unknown): asserts code is string {
    if (
      typeof code !== 'string' ||
      code.trim().length === 0 ||
      code.length > MAX_AUTH_CODE_LENGTH
    ) {
      throw new Error('Invalid Microsoft authorization code');
    }
  }

  private tokenExchangeRequest(code: string): RequestInit {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email offline_access',
    });
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    };
  }

  private async consumeTokenResponse(
    res: Response,
  ): Promise<UpstreamAttemptResult<TokenExchangeResult>> {
    if (!res.ok) {
      return {
        ok: false,
        error: new Error(`Token exchange failed: ${res.status}`),
        outcome: 'http_error',
        reason: 'http-not-ok',
        status: res.status,
      };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {
        ok: false,
        error: new Error('Token exchange response invalid'),
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: res.status,
      };
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as { access_token?: unknown }).access_token !== 'string' ||
      (data as { access_token: string }).access_token.length === 0
    ) {
      return {
        ok: false,
        error: new Error('Token exchange response invalid'),
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: res.status,
      };
    }
    return {
      ok: true,
      value: {
        accessToken: (data as { access_token: string }).access_token,
        sessionCookies: res.headers.get('set-cookie') ?? '',
      },
      outcome: 'ok',
      status: res.status,
    };
  }

  async handleCallback(
    code: string,
    state?: string,
  ): Promise<{ accessToken: string; sessionCookies: string }> {
    const expiresAt = state ? this.pendingStates.get(state) : undefined;
    const now = this.runtime.wallNowMs();
    if (!state || expiresAt === undefined || now >= expiresAt) {
      if (state) this.pendingStates.delete(state);
      throw new Error('Invalid or missing OIDC state (CSRF protection)');
    }
    this.pendingStates.delete(state);
    this.validateAuthorizationCode(code);

    return timedFetch(
      this.runtime,
      this.tokenExchangeContext(),
      this.tokenExchangeUrl(),
      this.tokenExchangeRequest(code),
      (res) => this.consumeTokenResponse(res),
    );
  }
}
