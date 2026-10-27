import 'reflect-metadata';
import { SiapService } from './siap.service';
import { SiapUpstreamSession } from './siap-upstream.session';
import type { SessionStore } from '../session/session-store';
import type { TelemetryRuntime } from '../observability/telemetry';

const COOKIE = 'sia_app_session=test-session';
const NIM = '20999999999999';
const DASHBOARD = 'https://siap.undip.ac.id/pages/mhs/dashboard';
const PROFILE = `<div id="tabmhs_profile"><b>NIM</b>:</div><div class="col-sm-9">${NIM}</div>`;

type RenewalValidator = {
  validateSessionCookieForRenewal(cookie: string): Promise<unknown>;
};

function service(runtime?: TelemetryRuntime): RenewalValidator {
  const store = {} as SessionStore;
  return new SiapService(store, undefined, new SiapUpstreamSession(store, undefined, undefined, undefined, runtime)) as unknown as RenewalValidator;
}

function response(status: number, html: string, url = DASHBOARD): Response {
  return { ok: status >= 200 && status < 300, status, url, text: async () => html } as Response;
}

describe('SIAP cookie renewal validation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the identity from the authenticated SIAP dashboard', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(response(200, PROFILE));
    await expect(service().validateSessionCookieForRenewal(COOKIE)).resolves.toEqual({
      kind: 'valid', identity: NIM,
    });
    expect(fetch).toHaveBeenCalledWith(DASHBOARD, expect.objectContaining({
      headers: { Cookie: COOKIE },
    }));
  });

  it.each([
    ['rejected cookie', response(401, '')],
    ['login redirect', response(200, '<html>login</html>', 'https://login.microsoftonline.com/login')],
    ['missing dashboard marker', response(200, '<html>login</html>')],
    ['marker outside the profile element', response(200, `<script>var tabmhs_profile = true</script><b>NIM</b>:</div><div class="col-sm-9">${NIM}</div>`)],
    ['missing identity', response(200, '<div id="tabmhs_profile"></div>')],
  ])('rejects %s as invalid', async (_label, reply) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(reply);
    await expect(service().validateSessionCookieForRenewal(COOKIE)).resolves.toEqual({ kind: 'invalid' });
  });

  it.each([429, 503])('maps upstream HTTP %s to unavailable', async (status) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(status, ''));
    await expect(service().validateSessionCookieForRenewal(COOKIE)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('maps transport failures to unavailable without exposing the error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error(`network ${COOKIE}`));
    const result = await service().validateSessionCookieForRenewal(COOKIE);
    expect(result).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(COOKIE);
  });

  it('does not emit cookie or identity values in renewal telemetry', async () => {
    const events: unknown[] = [];
    const runtime: TelemetryRuntime = {
      sink: { record: (event) => { events.push(event); } },
      wallNowMs: () => 0,
      monotonicNowNs: () => 0n,
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(response(200, PROFILE));
    await service(runtime).validateSessionCookieForRenewal(COOKIE);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(COOKIE);
    expect(JSON.stringify(events)).not.toContain(NIM);
  });
});
