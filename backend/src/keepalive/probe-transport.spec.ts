import { createNoopTelemetryRuntime } from '../observability/telemetry';
import { probeWithRedirects } from './probe-transport';

const CONTEXT = {
  service: 'sso',
  operation: 'login_page',
  route: 'GET /auth/user/login',
} as const;

function response(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): Response {
  return new Response(body, { status, headers });
}

describe('probeWithRedirects', () => {
  const runtime = createNoopTelemetryRuntime();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures Set-Cookie from the redirect hop and stops at the landing path', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(302, {
          location: '/pages/dashboard',
          'set-cookie': 'ci_session_sso=NEW; Path=/',
        }),
      );

    const hops = await probeWithRedirects(
      runtime,
      CONTEXT,
      'https://sso.undip.ac.id/auth/user/login',
      { method: 'GET', headers: { Cookie: 'ci_session_sso=OLD' } },
      {
        stopWhen: (hop) =>
          !!hop.location && new URL(hop.location, hop.url).pathname === '/pages/dashboard',
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hops).toHaveLength(1);
    expect(hops[0].setCookies).toEqual(['ci_session_sso=NEW; Path=/']);
    expect(hops[0].location).toBe('/pages/dashboard');
  });

  it('captures Set-Cookie from both the initial response and a followed redirect', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(302, {
          location: '/next',
          'set-cookie': 'ci_session_sso=FIRST; Path=/',
        }),
      )
      .mockResolvedValueOnce(
        response(200, { 'set-cookie': 'ci_session_sso=SECOND; Path=/' }, 'ok'),
      );

    const hops = await probeWithRedirects(
      runtime,
      CONTEXT,
      'https://sso.undip.ac.id/auth/user/login',
      { method: 'GET' },
      { readBody: (hop) => hop.status === 200 },
    );

    expect(hops.flatMap((hop) => hop.setCookies)).toEqual([
      'ci_session_sso=FIRST; Path=/',
      'ci_session_sso=SECOND; Path=/',
    ]);
  });

  it('does not follow a cross-origin redirect and never forwards the cookie', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(302, { location: 'https://sso.undip.ac.id/login' }),
      );

    const hops = await probeWithRedirects(
      runtime,
      { ...CONTEXT, service: 'kulon', operation: 'session_probe', route: 'GET /my/' },
      'https://kulon2.undip.ac.id/my/',
      { method: 'GET', headers: { Cookie: 'MoodleSession=OLD' } },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hops[0].status).toBe(302);
  });

  it('stops after four redirects (five requests)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(302, { location: '/loop' }),
    );

    const hops = await probeWithRedirects(
      runtime,
      CONTEXT,
      'https://sso.undip.ac.id/auth/user/login',
      { method: 'GET' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(hops).toHaveLength(5);
  });
});
