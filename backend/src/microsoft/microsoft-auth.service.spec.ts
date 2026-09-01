import 'reflect-metadata';
import { MicrosoftAuthService } from './microsoft-auth.service';
import type { TelemetryRuntime } from '../observability/telemetry';

describe('MicrosoftAuthService', () => {
  let svc: MicrosoftAuthService;
  const clock = { wall: 1_700_000_000_000, monotonic: 0n };
  const events: unknown[] = [];

  function runtime(): TelemetryRuntime {
    return {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => clock.wall,
      monotonicNowNs: () => {
        clock.monotonic += 1_000_000n;
        return clock.monotonic;
      },
    };
  }

  beforeEach(() => {
    svc = new MicrosoftAuthService({
      tenantId: '03290435-ff74-45d1-aeaa-173677221cf8',
      clientId: 'd4e33023-d86d-4234-8a41-cd60a2145e36',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/auth/microsoft/callback',
    }, runtime());
    clock.wall = 1_700_000_000_000;
    clock.monotonic = 0n;
    events.length = 0;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('builds authorize url with tenant and state param', () => {
    const url = svc.getAuthUrl();
    expect(url).toContain('03290435-ff74-45d1-aeaa-173677221cf8');
    expect(url).toContain('oauth2/v2.0/authorize');
    expect(url).toContain('client_id=d4e33023-d86d-4234-8a41-cd60a2145e36');
    expect(url).toMatch(/state=/);
  });

  it('exchanges code for token and captures session cookie with valid state', async () => {
    const authUrl = svc.getAuthUrl();
    const state = new URL(authUrl).searchParams.get('state')!;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at', refresh_token: 'rt' }),
      headers: new Headers({
        'set-cookie': 'ESTSAUTH=ESTSAUTH-COOKIE; Path=/; HttpOnly',
      }),
    });
    const res = await svc.handleCallback('authcode', state);
    expect(res.accessToken).toBe('at');
    expect(res.sessionCookies).toContain('ESTSAUTH=ESTSAUTH-COOKIE');
  });

  it('rejects callback with missing or invalid state (CSRF)', async () => {
    await expect(svc.handleCallback('authcode')).rejects.toThrow(
      'Invalid or missing OIDC state',
    );
    await expect(svc.handleCallback('authcode', 'forged-state')).rejects.toThrow(
      'Invalid or missing OIDC state',
    );
  });

  it.each([10 * 60_000, 10 * 60_000 + 1])(
    'rejects an expired state before network at wall time +%d ms',
    async (elapsed) => {
      const state = new URL(svc.getAuthUrl()).searchParams.get('state')!;
      clock.wall += elapsed;

      await expect(svc.handleCallback('authcode', state)).rejects.toThrow(
        'Invalid or missing OIDC state (CSRF protection)',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('consumes a valid state once even when the callback is repeated', async () => {
    const state = new URL(svc.getAuthUrl()).searchParams.get('state')!;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at' }),
      headers: new Headers(),
    });

    await expect(svc.handleCallback('authcode', state)).resolves.toMatchObject({
      accessToken: 'at',
    });
    await expect(svc.handleCallback('authcode', state)).rejects.toThrow(
      'Invalid or missing OIDC state (CSRF protection)',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on token exchange failure', async () => {
    const authUrl = svc.getAuthUrl();
    const state = new URL(authUrl).searchParams.get('state')!;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      headers: new Headers(),
    });
    await expect(svc.handleCallback('badcode', state)).rejects.toThrow(
      'Token exchange failed',
    );
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'microsoft',
        operation: 'token_exchange',
        route: 'POST /oauth2/v2.0/token',
        outcome: 'http_error',
        status: 400,
        durationMs: 1,
      }),
    ]);
  });

  it('classifies malformed token JSON without exposing body or parser details', async () => {
    const state = new URL(svc.getAuthUrl()).searchParams.get('state')!;
    const secretBody = 'malformed-secret-body';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error(`parser leaked ${secretBody}`);
      },
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(svc.handleCallback('badcode', state)).rejects.toThrow(
      'Token exchange response invalid',
    );
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: 200,
        durationMs: 1,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secretBody);
  });

  it('records network failure duration without exposing the thrown message', async () => {
    const state = new URL(svc.getAuthUrl()).searchParams.get('state')!;
    const secretMessage = 'network-secret-message';
    const error = new Error(secretMessage);
    (global.fetch as jest.Mock).mockRejectedValue(error);

    await expect(svc.handleCallback('badcode', state)).rejects.toBe(error);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'microsoft',
        operation: 'token_exchange',
        outcome: 'network_error',
        reason: 'fetch-threw',
        durationMs: 1,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secretMessage);
  });

  it('preserves the configured tenant path and rejects a wrong tenant before network', async () => {
    const tenant = 'tenant-a';
    svc = new MicrosoftAuthService(
      {
        tenantId: tenant,
        clientId: 'client',
        clientSecret: 'secret',
        redirectUri: 'http://localhost/callback',
      },
      runtime(),
    );
    const state = new URL(svc.getAuthUrl()).searchParams.get('state')!;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at' }),
      headers: new Headers(),
    });

    await svc.handleCallback('authcode', state);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    );

    expect(
      () =>
        new MicrosoftAuthService(
          {
            tenantId: 'tenant-a/tenant-b',
            clientId: 'client',
            clientSecret: 'secret',
            redirectUri: 'http://localhost/callback',
          },
          runtime(),
        ),
    ).toThrow('Invalid Microsoft tenant path');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
