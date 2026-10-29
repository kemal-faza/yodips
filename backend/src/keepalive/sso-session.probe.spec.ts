import { ConfigService } from '@nestjs/config';
import { SsoSessionProbe } from './sso-session.probe';

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

describe('SsoSessionProbe', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is valid on a redirect to /pages/dashboard', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: '/pages/dashboard',
          'set-cookie': 'ci_session_sso=NEW; Path=/',
        },
      }),
    );
    const probe = new SsoSessionProbe(config({ SSO_BASE_URL: 'https://sso.undip.ac.id' }));
    await expect(probe.probe('ci_session_sso=OLD')).resolves.toEqual({
      valid: true,
      setCookies: ['ci_session_sso=NEW; Path=/'],
    });
  });

  it('falls back to SSO_BASE_URL when SSO_LOGIN_URL is absent', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 401 }));
    const probe = new SsoSessionProbe(
      config({ SSO_LOGIN_URL: '', SSO_BASE_URL: 'https://sso.undip.ac.id/' }),
    );
    await probe.probe('ci_session_sso=OLD');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sso.undip.ac.id/auth/user/login');
  });

  it('returns invalid on a 200 login page', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<form name="login"></form>', { status: 200 }),
    );
    const probe = new SsoSessionProbe(config({ SSO_BASE_URL: 'https://sso.undip.ac.id' }));
    await expect(probe.probe('ci_session_sso=OLD')).resolves.toEqual({
      valid: false,
      kind: 'invalid',
      setCookies: [],
    });
  });

  it('returns rate-limited on 429', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    const probe = new SsoSessionProbe(config({ SSO_BASE_URL: 'https://sso.undip.ac.id' }));
    await expect(probe.probe('ci_session_sso=OLD')).resolves.toEqual({
      valid: false,
      kind: 'rate-limited',
      setCookies: [],
    });
  });
});
