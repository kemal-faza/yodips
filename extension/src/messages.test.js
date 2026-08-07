import { describe, it, expect, vi } from 'vitest';
import {
  handleHandoffMessage,
  cookiesToStr,
  generateTicket,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
  evaluateCookies,
  nextAction,
  buildHandoffBody,
  performHandoff,
} from './messages.js';

function makeDeps(overrides = {}) {
  const deps = {
    getCookies: vi.fn().mockResolvedValue([]),
    getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000'),
    fetchHandoff: vi.fn().mockResolvedValue({ ok: true, status: 200, accessToken: 'jwt' }),
    openTab: vi.fn().mockResolvedValue({ id: 1 }),
    navigateTab: vi.fn().mockResolvedValue(undefined),
    closeTab: vi.fn().mockResolvedValue(undefined),
    kulonLoginUrl: 'https://kulon2.undip.ac.id/auth/oidc/?t=k',
    siapLoginUrl: 'https://siap.undip.ac.id/sso/login?t=s',
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

describe('ticket helpers', () => {
  it('generateTicket returns base64 of the current unix second (backend-compatible)', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(generateTicket()).toBe(Buffer.from(String(now)).toString('base64'));
  });

  it('generateTicket works without Node Buffer (MV3 service worker)', () => {
    const original = globalThis.Buffer;
    delete globalThis.Buffer;
    try {
      const ticket = generateTicket();
      expect(typeof ticket).toBe('string');
      expect(ticket).toMatch(/^[A-Za-z0-9+/=]+$/);
    } finally {
      globalThis.Buffer = original;
    }
  });

  it('buildKulonTicketUrl points at the Kulon OIDC endpoint with a fresh ticket', () => {
    const url = buildKulonTicketUrl();
    expect(url.startsWith('https://kulon2.undip.ac.id/auth/oidc/?t=')).toBe(true);
  });

  it('buildSiapTicketUrl points at the SIAP SSO endpoint with a fresh ticket', () => {
    const url = buildSiapTicketUrl();
    expect(url.startsWith('https://siap.undip.ac.id/sso/login?t=')).toBe(true);
  });
});

describe('evaluateCookies', () => {
  it('detects kulon only', () => {
    expect(evaluateCookies([KULON])).toEqual({ hasKulon: true, hasSiap: false });
  });

  it('detects siap only', () => {
    expect(evaluateCookies([SIAP])).toEqual({ hasKulon: false, hasSiap: true });
  });

  it('detects both', () => {
    expect(evaluateCookies([KULON, SIAP])).toEqual({ hasKulon: true, hasSiap: true });
  });

  it('returns false both when empty', () => {
    expect(evaluateCookies([])).toEqual({ hasKulon: false, hasSiap: false });
  });
});

describe('nextAction', () => {
  it('open-siap when kulon logged in and siap missing (phase kulon)', () => {
    expect(nextAction({ phase: 'kulon' }, [KULON, SSO])).toBe('open-siap');
  });

  it('wait while kulon still missing (phase kulon)', () => {
    expect(nextAction({ phase: 'kulon' }, [SSO])).toBe('wait');
  });

  it('handoff when both present (phase kulon)', () => {
    expect(nextAction({ phase: 'kulon' }, [KULON, SIAP])).toBe('handoff');
  });

  it('wait while siap still missing (phase siap)', () => {
    expect(nextAction({ phase: 'siap' }, [KULON, SSO])).toBe('wait');
  });

  it('handoff when siap appears (phase siap)', () => {
    expect(nextAction({ phase: 'siap' }, [KULON, SIAP])).toBe('handoff');
  });
});

describe('buildHandoffBody', () => {
  it('builds the full cookie body', () => {
    expect(buildHandoffBody([KULON, SSO, SIAP, MS])).toEqual({
      kulonCookie: 'MoodleSession=abc',
      ssoCookie: 'csrftoken=sso1',
      microsoftCookie: 'MSAuth=ms1',
      siapCookie: 'sia_app_session=siap1',
    });
  });
});

describe('performHandoff', () => {
  it('returns accessToken on success', async () => {
    const deps = makeDeps();
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res).toEqual({ ok: true, accessToken: 'jwt' });
    expect(deps.fetchHandoff).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/session/handoff',
      expect.objectContaining({ kulonCookie: 'MoodleSession=abc' }),
    );
  });

  it('returns error with message on handoff failure (strips trailing slash)', async () => {
    const deps = makeDeps({
      getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000/'),
      fetchHandoff: vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    });
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.message).toContain('429');
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
    const res = await handleHandoffMessage({ action: 'explode' }, makeDeps());
    expect(res.status).toBe('error');
  });

  it('performs handoff immediately when both cookies already present', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([KULON, SIAP]) });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ ok: true, accessToken: 'jwt', status: 'ok' });
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it('returns started when a cookie is missing (lets background orchestrate)', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([KULON]) });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'started' });
  });
});
