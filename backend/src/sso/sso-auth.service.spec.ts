import 'reflect-metadata';
import { SSOAuthService } from './sso-auth.service';
import { SSOTicketService } from './ticket.service';
import type { TelemetryRuntime } from '../observability/telemetry';

describe('SSOAuthService', () => {
  let svc: SSOAuthService;
  const baseUrl = 'https://sso.undip.ac.id';
  const clock = { monotonic: 0n };
  const events: unknown[] = [];

  function runtime(): TelemetryRuntime {
    return {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => 1_700_000_000_000,
      monotonicNowNs: () => {
        clock.monotonic += 1_000_000n;
        return clock.monotonic;
      },
    };
  }

  beforeEach(() => {
    svc = new SSOAuthService(new SSOTicketService(), runtime());
    clock.monotonic = 0n;
    events.length = 0;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('extracts csrf token from login page', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({}),
      text: async () =>
        `<input type="hidden" name="csrf_sso" value="abc123">`,
    });
    const token = await svc.getCsrfToken(baseUrl);
    expect(token).toBe('abc123');
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'sso',
        operation: 'login_page',
        route: 'GET /auth/user/login',
        outcome: 'ok',
      status: 200,
        durationMs: 1,
      }),
    ]);
  });

  it('returns session cookie + redirect url from login', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="csrf123">`,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({
          'set-cookie': 'ci_session_sso=xyz; Path=/',
          location: '/pages/dashboard',
        }),
        text: async () => '',
      });
    const { cookie, redirectUrl } = await svc.login(baseUrl, 'n2m', 'pass');
    expect(cookie).toContain('ci_session_sso=xyz');
    expect(redirectUrl).toContain('dashboard');
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'sso',
        operation: 'login_page',
        outcome: 'ok',
        status: 200,
      }),
      expect.objectContaining({
        event: 'upstream.request',
        service: 'sso',
        operation: 'session_exchange',
        route: 'POST /sso/auth_v2',
        outcome: 'ok',
        status: 302,
        durationMs: 1,
      }),
    ]);
  });

  it('throws when login returns no session cookie', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="abc">`,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ location: '/auth/user/login' }),
        text: async () => '',
      });
    await expect(svc.login(baseUrl, 'n2m', 'wrong')).rejects.toThrow(
      'Login failed',
    );
  });

  it('strips response attributes and merges multiple Set-Cookie entries (B2)', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="csrf123">`,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: new Headers({
          'set-cookie': 'ci_session_sso=xyz; Path=/; HttpOnly; Secure, csrftoken=qwerty; Path=/',
          location: '/pages/dashboard',
        }),
        text: async () => '',
      });
    const { cookie } = await svc.login(baseUrl, 'n2m', 'pass');
    // Only name=value pairs, no Path=/ HttpOnly Secure response attributes.
    expect(cookie).toBe('ci_session_sso=xyz; csrftoken=qwerty');
  });

  it('persists and re-sends the CSRF session cookie on the login POST (B7)', async () => {
    const setCookieFromGet = 'ci_session_sso=prelogin; Path=/; HttpOnly';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'set-cookie': setCookieFromGet }),
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="csrf123">`,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: new Headers({
          'set-cookie': 'ci_session_sso=postlogin; Path=/',
          location: '/pages/dashboard',
        }),
        text: async () => '',
      });
    const { cookie } = await svc.login(baseUrl, 'n2m', 'pass');

    // The POST must carry the session cookie set by the GET (CSRF binding).
    const [, postCall] = (global.fetch as jest.Mock).mock.calls;
    expect(postCall[1].headers.Cookie).toBe('ci_session_sso=prelogin');
    // The returned cookie is the PARSED (name=value only) set-cookie from the POST.
    expect(cookie).toBe('ci_session_sso=postlogin');
  });

  it('records transport failure without exposing credentials or exception text', async () => {
    const secretMessage = 'network-secret-message';
    const error = new Error(secretMessage);
    (global.fetch as jest.Mock).mockRejectedValue(error);

    await expect(svc.login(baseUrl, 'identity-secret', 'password-secret')).rejects.toBe(error);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'sso',
        operation: 'login_page',
        outcome: 'network_error',
        reason: 'fetch-threw',
        durationMs: 1,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secretMessage);
    expect(JSON.stringify(events)).not.toContain('identity-secret');
    expect(JSON.stringify(events)).not.toContain('password-secret');
  });

  it('generates a new ticket via ticket service', () => {
    const t = svc.newTicket();
    expect(Buffer.from(t, 'base64').toString()).toMatch(/^\d+$/);
  });
});
