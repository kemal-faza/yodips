import { describe, it, expect, vi } from 'vitest';
import {
  handleHandoffMessage,
  cookiesToStr,
  generateTicket,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
  evaluateCookies,
  nextAction,
  nextHandoffStep,
  reloginPhase,
  buildHandoffBody,
  performHandoff,
  cookiePatternsForPhase,
  phasesToClear,
  summarizeHandoff,
} from './messages.js';

function makeDeps(overrides = {}) {
  const deps = {
    getCookies: vi.fn().mockResolvedValue([]),
    getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000'),
    fetchHandoff: vi.fn().mockResolvedValue({ ok: true, status: 200, accessToken: 'jwt' }),
    openTab: vi.fn().mockResolvedValue({ id: 1 }),
    navigateTab: vi.fn().mockResolvedValue(undefined),
    closeTab: vi.fn().mockResolvedValue(undefined),
    getLastResult: vi.fn().mockResolvedValue(null),
    clearLastResult: vi.fn().mockResolvedValue(undefined),
    clearSessionCookies: vi.fn().mockResolvedValue(undefined),
    getFlowState: vi.fn().mockResolvedValue(null),
    kulonLoginUrl: 'https://kulon2.undip.ac.id/auth/oidc/?t=k',
    siapLoginUrl: 'https://siap.undip.ac.id/sso/login?t=s',
    ...overrides,
  };
  return deps;
}

const KULON = { domain: 'sub.kulon2.undip.ac.id', name: 'MoodleSession', value: 'abc' };
const SSO = { domain: 'sso.undip.ac.id', name: 'csrftoken', value: 'sso1' };
const SSO_SESSION = { domain: 'sso.undip.ac.id', name: 'ci_session_sso', value: 'ssoX' };
const SIAP = { domain: 'siap.undip.ac.id', name: 'sia_app_session', value: 'siap1' };
const MS = { domain: 'login.live.com', name: 'MSAuth', value: 'ms1' };
const UNDIP_PARENT_SIAP = { domain: 'undip.ac.id', name: 'sia_app_session', value: 'pSiap' };
const UNDIP_PARENT_SSO = { domain: 'undip.ac.id', name: 'ci_session_sso', value: 'pSso' };

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
    expect(evaluateCookies([KULON])).toEqual({ hasSso: false, hasKulon: true, hasSiap: false });
  });

  it('detects siap only', () => {
    expect(evaluateCookies([SIAP])).toEqual({ hasSso: false, hasKulon: false, hasSiap: true });
  });

  it('detects both', () => {
    expect(evaluateCookies([KULON, SIAP])).toEqual({ hasSso: false, hasKulon: true, hasSiap: true });
  });

  it('returns all false when empty', () => {
    expect(evaluateCookies([])).toEqual({ hasSso: false, hasKulon: false, hasSiap: false });
  });

  it('detects the SSO session only by the exact ci_session_sso cookie name', () => {
    expect(evaluateCookies([SSO_SESSION])).toEqual({ hasSso: true, hasKulon: false, hasSiap: false });
  });

  it('does not treat a csrftoken cookie as an SSO session', () => {
    expect(evaluateCookies([SSO])).toEqual({ hasSso: false, hasKulon: false, hasSiap: false });
  });

  it('detects an SSO session cookie stored on the parent undip.ac.id domain', () => {
    expect(evaluateCookies([UNDIP_PARENT_SSO])).toEqual({ hasSso: true, hasKulon: false, hasSiap: false });
  });

  it('detects a SIAP session cookie stored on the parent undip.ac.id domain', () => {
    expect(evaluateCookies([UNDIP_PARENT_SIAP])).toEqual({ hasSso: false, hasKulon: false, hasSiap: true });
  });

  it('does NOT count a non-MoodleSession cookie on the kulon domain as a Kulon login', () => {
    const oidcPreAuth = { domain: 'kulon2.undip.ac.id', name: 'csrftoken', value: 'x' };
    expect(evaluateCookies([oidcPreAuth])).toEqual({ hasSso: false, hasKulon: false, hasSiap: false });
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

  it('open-kulon when the SSO session is present (phase sso)', () => {
    expect(nextAction({ phase: 'sso' }, [SSO_SESSION])).toBe('open-kulon');
  });

  it('wait while the SSO session is still missing (phase sso)', () => {
    expect(nextAction({ phase: 'sso' }, [SSO])).toBe('wait');
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

  it('includes SIAP/SSO cookies stored on the parent undip.ac.id domain', () => {
    expect(buildHandoffBody([KULON, SIAP, MS, UNDIP_PARENT_SIAP, UNDIP_PARENT_SSO])).toEqual({
      kulonCookie: 'MoodleSession=abc',
      ssoCookie: 'ci_session_sso=pSso',
      microsoftCookie: 'MSAuth=ms1',
      siapCookie: 'sia_app_session=siap1; sia_app_session=pSiap',
    });
  });
});

describe('performHandoff', () => {
  it('returns accessToken and session flags on success', async () => {
    const deps = makeDeps({
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        accessToken: 'jwt',
        hasSso: true,
        hasMicrosoft: false,
        hasKulon: true,
        hasSiap: true,
      }),
    });
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res).toEqual({
      ok: true,
      accessToken: 'jwt',
      hasSso: true,
      hasMicrosoft: false,
      hasKulon: true,
      hasSiap: true,
    });
    expect(deps.fetchHandoff).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/session/handoff',
      expect.objectContaining({ kulonCookie: 'MoodleSession=abc' }),
    );
  });

  it('returns error with message on handoff failure (strips trailing slash)', async () => {
    const deps = makeDeps({
      getServerUrl: vi.fn().mockResolvedValue('http://localhost:3000/'),
      fetchHandoff: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.message).toContain('500');
  });

  it('formats status 429 with clear Indonesian error message', async () => {
    const deps = makeDeps({
      fetchHandoff: vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    });
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.message).toContain('Terlalu banyak percobaan handoff');
  });

  it('propagates the backend stale-session code/reason on a 401', async () => {
    const deps = makeDeps({
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        code: 'KULON_STALE',
        reason: 'stale',
        message: 'Session Kulon tidak valid — silakan login ulang',
      }),
    });
    const res = await performHandoff(deps, [KULON, SIAP]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.code).toBe('KULON_STALE');
    expect(res.reason).toBe('stale');
  });
});

describe('handleHandoffMessage', () => {
  it('answers ping with ok without touching cookies', async () => {
    const deps = makeDeps();
    const res = await handleHandoffMessage({ action: 'ping' }, deps);
    expect(res).toEqual({ status: 'ok' });
    expect(deps.getCookies).not.toHaveBeenCalled();
  });

  it('result returns the last stored payload without side effects', async () => {
    const deps = makeDeps({
      getLastResult: vi.fn().mockResolvedValue({ status: 'ok', accessToken: 'jwt' }),
    });
    const res = await handleHandoffMessage({ action: 'result' }, deps);
    expect(res).toEqual({ status: 'ok', accessToken: 'jwt' });
    expect(deps.getCookies).not.toHaveBeenCalled();
    expect(deps.getLastResult).toHaveBeenCalled();
  });

  it('result returns {status: active} when no result is stored yet', async () => {
    const deps = makeDeps({ getLastResult: vi.fn().mockResolvedValue(null) });
    const res = await handleHandoffMessage({ action: 'result' }, deps);
    expect(res).toEqual({ status: 'active' });
  });

  it('rejects an unknown action with error', async () => {
    const res = await handleHandoffMessage({ action: 'explode' }, makeDeps());
    expect(res.status).toBe('error');
  });

  it('logout clears the session cookies and returns ok (no tab opened)', async () => {
    const deps = makeDeps();
    const res = await handleHandoffMessage({ action: 'logout' }, deps);
    expect(res).toEqual({ status: 'ok' });
    expect(deps.clearSessionCookies).toHaveBeenCalled();
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.getCookies).not.toHaveBeenCalled();
  });

  it('performs handoff immediately when backend verifies sso, kulon and siap', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SIAP, SSO_SESSION]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: true, status: 200, accessToken: 'jwt',
        hasSso: true, hasKulon: true, hasSiap: true,
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'ok', accessToken: 'jwt' });
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it('returns started with phase sso when a cookie is missing (lets background orchestrate)', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([KULON]) });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'started', incomplete: true, phase: 'sso' });
  });

  it('clears the stored last result when a new handoff/orchestration starts', async () => {
    const deps = makeDeps({ getCookies: vi.fn().mockResolvedValue([KULON]) });
    await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(deps.clearLastResult).toHaveBeenCalled();
  });

  it('returns started with phase sso when the SSO session is missing even with kulon+siap present', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SIAP]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: true, status: 200, accessToken: 'jwt',
        hasSso: false, hasKulon: true, hasSiap: false,
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'started', incomplete: true, phase: 'sso' });
  });

  it('returns started with phase siap when only siap is missing/back-end-invalid', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SSO_SESSION]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: true, status: 200, accessToken: 'jwt',
        hasSso: true, hasKulon: true, hasSiap: false,
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'started', incomplete: true, phase: 'siap' });
  });

  it('re-orchestrates siap when the backend reports it invalid even though the cookie is present (no silent reuse)', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SIAP, SSO_SESSION]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: true, status: 200, accessToken: 'jwt',
        hasSso: true, hasKulon: true, hasSiap: false,
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res).toEqual({ status: 'started', incomplete: true, phase: 'siap' });
  });

  it('returns relogin when the backend reports an expired (stale) Kulon session', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SIAP, SSO_SESSION]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        code: 'KULON_STALE',
        message: 'Session Kulon tidak valid — silakan login ulang',
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res.status).toBe('relogin');
  });

  it('returns error with code for a fatal handoff failure', async () => {
    const deps = makeDeps({
      getCookies: vi.fn().mockResolvedValue([KULON, SIAP, SSO_SESSION]),
      fetchHandoff: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        code: 'KULON_NO_COOKIE',
      }),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res.status).toBe('error');
    expect(res.code).toBe('KULON_NO_COOKIE');
  });

  it('does NOT open a second flow when one is already active (re-click while a login tab is open)', async () => {
    const deps = makeDeps({
      getFlowState: vi.fn().mockResolvedValue({
        tabId: 7,
        tabs: [7],
        phase: 'sso',
        deadline: Date.now() + 60_000,
      }),
      getCookies: vi.fn().mockResolvedValue([]),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res.status).toBe('started');
    expect(res.resume).toBe(true);
    expect(res.phase).toBe('sso');
    // A re-click while a flow is running must be a pure read — no cookie
    // capture, no cached-result wipe, no handoff POST (would burn throttle).
    expect(deps.getCookies).not.toHaveBeenCalled();
    expect(deps.clearLastResult).not.toHaveBeenCalled();
    expect(deps.fetchHandoff).not.toHaveBeenCalled();
  });

  it('starts a FRESH flow when the previous flow state has expired', async () => {
    const deps = makeDeps({
      getFlowState: vi.fn().mockResolvedValue({
        tabId: 7,
        tabs: [7],
        phase: 'sso',
        deadline: Date.now() - 1000,
      }),
      getCookies: vi.fn().mockResolvedValue([]),
    });
    const res = await handleHandoffMessage({ action: 'handoff' }, deps);
    expect(res.status).toBe('started');
    expect(res.resume).toBeUndefined();
    expect(deps.getCookies).toHaveBeenCalled();
  });
});

describe('nextHandoffStep', () => {
  it('returns ok when the backend verifies sso, kulon and siap', () => {
    expect(
      nextHandoffStep({ ok: true, accessToken: 'jwt', hasSso: true, hasKulon: true, hasSiap: true }),
    ).toEqual({ action: 'ok', accessToken: 'jwt' });
  });

  it('re-opens siap when only siap is invalid (regardless of cookie presence)', () => {
    expect(
      nextHandoffStep({ ok: true, accessToken: 'jwt', hasSso: true, hasKulon: true, hasSiap: false }),
    ).toEqual({ action: 'open', phase: 'siap' });
  });

  it('re-opens sso when only sso is invalid', () => {
    expect(
      nextHandoffStep({ ok: true, accessToken: 'jwt', hasSso: false, hasKulon: true, hasSiap: true }),
    ).toEqual({ action: 'open', phase: 'sso' });
  });

  it('re-opens kulon when only kulon is invalid', () => {
    expect(
      nextHandoffStep({ ok: true, accessToken: 'jwt', hasSso: true, hasKulon: false, hasSiap: true }),
    ).toEqual({ action: 'open', phase: 'kulon' });
  });

  it('returns error when the handoff failed', () => {
    expect(
      nextHandoffStep({ ok: false, status: 500, message: 'Handoff gagal (500)' }),
    ).toEqual({ action: 'error', message: 'Handoff gagal (500)' });
  });
});

describe('reloginPhase', () => {
  it('returns kulon when the SSO session is still valid (KULON_STALE means only Kulon is stale)', () => {
    expect(reloginPhase({ hasSso: true })).toBe('kulon');
  });

  it('returns sso when the SSO session is missing (must re-establish from the start)', () => {
    expect(reloginPhase({ hasSso: false })).toBe('sso');
  });
});

describe('cookiePatternsForPhase', () => {
  it('targets the Kazan ci_session_sso cookie for phase sso', () => {
    const patterns = cookiePatternsForPhase('sso');
    expect(patterns).toHaveLength(2);
    for (const p of patterns) expect(p.name).toBe('ci_session_sso');
    expect(patterns.some((p) => p.domain.includes('sso.undip.ac.id'))).toBe(true);
  });

  it('targets only MoodleSession cookies for phase kulon', () => {
    const patterns = cookiePatternsForPhase('kulon');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].domain).toContain('kulon2.undip.ac.id');
    expect(patterns[0].name.test('MoodleSessionabc')).toBe(true);
    expect(patterns[0].name.test('csrftoken')).toBe(false);
  });

  it('targets SIAP session cookies for phase siap', () => {
    const patterns = cookiePatternsForPhase('siap');
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    const names = patterns.map((p) => p.name);
    for (const n of names) {
      expect(n.test('sia_app_session')).toBe(true);
      expect(n.test('ci_session_sso')).toBe(false);
      expect(n.test('MoodleSession')).toBe(false);
    }
  });
});

describe('phasesToClear', () => {
  it('clears the whole cascade when restarting from SSO (sso → kulon → siap)', () => {
    expect(phasesToClear('sso')).toEqual(['sso', 'kulon', 'siap']);
  });

  it('clears kulon and its downstream siap when only Kulon needs re-establishment', () => {
    expect(phasesToClear('kulon')).toEqual(['kulon', 'siap']);
  });

  it('clears only siap when only SIAP needs re-establishment', () => {
    expect(phasesToClear('siap')).toEqual(['siap']);
  });

  it('returns an empty list for an unknown phase', () => {
    expect(phasesToClear('nope')).toEqual([]);
  });
});

describe('summarizeHandoff', () => {
  it('keeps handoff diagnostics safe and excludes cookies and access tokens', () => {
    expect(summarizeHandoff({
      ok: false,
      status: 401,
      code: 'KULON_STALE',
      accessToken: 'jwt-secret',
      kulonCookie: 'MoodleSession=secret',
      hasSso: true,
      hasKulon: false,
      hasSiap: false,
    })).toEqual({
      ok: false,
      status: 401,
      code: 'KULON_STALE',
      hasSso: true,
      hasKulon: false,
      hasSiap: false,
    });
  });
});
