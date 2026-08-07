import { describe, it, expect, vi } from 'vitest';
import { handleHandoffMessage, cookiesToStr } from './messages.js';

function makeDeps(overrides = {}) {
  const deps = {
    getCookies: vi.fn().mockResolvedValue([KULON]),
    getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000'),
    fetchHandoff: vi.fn().mockResolvedValue({ ok: true, status: 200, accessToken: 'jwt' }),
    openTab: vi.fn().mockResolvedValue(undefined),
    ssologinUrl: 'https://sso.undip.ac.id/',
    ...overrides,
  };
  return deps;
}

const KULON = { domain: 'sub.kulon2.undip.ac.id', name: 'MoodleSession', value: 'abc' };
const SSO = { domain: 'sso.undip.ac.id', name: 'csrftoken', value: 'sso1' };
const SIAP = { domain: 'siap.undip.ac.id', name: 'sia_app_session', value: 'siap1' };
const MS = { domain: 'login.live.com', name: 'MSAuth', value: 'ms1' };

describe('cookiesToStr', () => {
  it('groups cookies matching a domain predicate into a cookie string', () => {
    const out = cookiesToStr([KULON, SSO], (d) => d.includes('undip.ac.id'));
    expect(out).toBe('MoodleSession=abc; csrftoken=sso1');
  });
});

describe('handleHandoffMessage', () => {
  it('answers ping with ok without touching cookies', async () => {
    const deps = makeDeps();
    const res = await handleHandoffMessage({ action: 'ping' }, deps);
    expect(res).toEqual({ status: 'ok' });
    expect(deps.getCookies).not.toHaveBeenCalled();
  });

  it('rejects an unknown action with error', async () => {
    const deps = makeDeps();
    const res = await handleHandoffMessage({ action: 'explode' }, deps);
    expect(res.status).toBe('error');
    expect(deps.getCookies).not.toHaveBeenCalled();
  });

  it('returns need-login and opens SSO login tab when kulon cookie missing', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([SSO]) });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'need-login' });
    expect(deps.openTab).toHaveBeenCalledWith('https://sso.undip.ac.id/');
    expect(deps.fetchHandoff).not.toHaveBeenCalled();
  });

  it('posts cookies to handoff and returns accessToken on success', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([KULON, SSO, SIAP, MS]) });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'ok', accessToken: 'jwt' });
    expect(deps.fetchHandoff).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/session/handoff',
      {
        kulonCookie: 'MoodleSession=abc',
        ssoCookie: 'csrftoken=sso1',
        siapCookie: 'sia_app_session=siap1',
        microsoftCookie: 'MSAuth=ms1',
      },
    );
  });

  it('uses server URL from storage (strips trailing slash)', async () => {
    const deps = makeDeps({ getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000/') });
    await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(deps.fetchHandoff).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/session/handoff',
      expect.any(Object),
    );
  });

  it('returns error when handoff request fails', async () => {
    const deps = makeDeps({
      fetchHandoff: vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res.status).toBe('error');
    expect(res.message).toContain('429');
  });
});
