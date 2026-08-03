import 'reflect-metadata';
import { MicrosoftAuthService } from './microsoft-auth.service';

describe('MicrosoftAuthService', () => {
  let svc: MicrosoftAuthService;

  beforeEach(() => {
    svc = new MicrosoftAuthService({
      tenantId: '03290435-ff74-45d1-aeaa-173677221cf8',
      clientId: 'd4e33023-d86d-4234-8a41-cd60a2145e36',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/auth/microsoft/callback',
    });
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
  });
});