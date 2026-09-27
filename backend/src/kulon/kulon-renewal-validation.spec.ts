import 'reflect-metadata';
import { SessionStore } from '../session/session-store';
import { KulonService } from './kulon.service';

const COOKIE = 'MoodleSession=renewed-session-value';
const PROFILE_TITLE =
  '<html><title>Student 24060121130077: Public profile</title></html>';
const MY_PAGE =
  '<html><input type="hidden" name="sesskey" value="sesskey-test"/></html>';

describe('KulonService.validateSessionCookieForRenewal', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: KulonService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new KulonService({} as SessionStore);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses read-only authenticated Kulon pages and returns the derived identity', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(MY_PAGE, { status: 200 }))
      .mockResolvedValueOnce(new Response(PROFILE_TITLE, { status: 200 }));

    await expect(
      service.validateSessionCookieForRenewal(COOKIE),
    ).resolves.toEqual({
      kind: 'valid',
      identity: '24060121130077',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([
      'https://kulon2.undip.ac.id/my/',
      'https://kulon2.undip.ac.id/user/profile.php',
    ]);
    for (const [, init] of calls) {
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.headers).toEqual({ Cookie: COOKIE });
    }
  });

  it('classifies a stale landing without a sesskey as an invalid cookie', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>login form</html>', { status: 200 }),
    );

    await expect(
      service.validateSessionCookieForRenewal(COOKIE),
    ).resolves.toEqual({
      kind: 'invalid',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies an upstream 5xx as unavailable rather than an invalid cookie', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('temporary failure', { status: 503 }),
    );

    await expect(
      service.validateSessionCookieForRenewal(COOKIE),
    ).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a network failure as unavailable', async () => {
    fetchMock.mockRejectedValueOnce(
      new Error('network error detail must not escape'),
    );

    await expect(
      service.validateSessionCookieForRenewal(COOKIE),
    ).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns invalid immediately for an absent cookie', async () => {
    await expect(service.validateSessionCookieForRenewal('')).resolves.toEqual({
      kind: 'invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
