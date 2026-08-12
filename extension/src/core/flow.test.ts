import { describe, it, expect } from 'vitest';
import { initialState, advance, attachTab, normalizeState, type FlowState, type FlowDeps } from './flow.js';

const LOGIN = { sso: 'SSO_URL', kulon: 'KULON_URL', siap: 'SIAP_URL' };
const D: FlowDeps = { flags: { hasSso: false, hasKulon: false, hasSiap: false }, now: () => 1_000_000, MAX_RELOGIN: 2, PHASE_TIMEOUT_MS: 1000, SSO_GUARD_MS: 1500, loginUrl: (s) => LOGIN[s] };

function st(mode: 'auto' | 'semi' = 'auto'): FlowState {
  return initialState(mode);
}

function auth(svc: FlowState['service'], mode: 'auto' | 'semi' = 'auto', tabId = 7): FlowState {
  return { ...st(mode), core: 'authing', service: svc, tabId };
}

/** COOKIE_SET carries the name(s) of cookies that actually changed. */
const COOKIE_SET = (changed: string[] | undefined = ['ci_session_sso']) => ({ type: 'COOKIE_SET' as const, changed });

describe('REQUEST', () => {
  it('starts authing:sso with no kulon cookie', () => {
    const r = advance(st(), { type: 'REQUEST', mode: 'auto' }, { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } });
    expect(r.state.core).toBe('authing');
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual(expect.arrayContaining([{ kind: 'openTab', url: 'SSO_URL' }]));
  });
  it('goes to handoff when kulon cookie present (verify before deciding)', () => {
    const r = advance(st(), { type: 'REQUEST', mode: 'auto' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('handoff');
    expect(r.state.deadline).toBe(D.now() + D.PHASE_TIMEOUT_MS);
    expect(r.effects).toContainEqual({ kind: 'postHandoff' });
  });
  it('resets from a terminal core:"error" state (stale persisted login failure)', () => {
    // Reproduces the stuck-state bug: a previous failed flow left core:'error'
    // in storage.local; the next REQUEST must start a fresh flow anyway.
    const stale = { ...st(), core: 'error', service: 'kulon', tabId: null } as FlowState;
    const r = advance(stale, { type: 'REQUEST', mode: 'auto' }, { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } });
    expect(r.state.core).toBe('authing');
    expect(r.state.service).toBe('sso');
    expect(r.state.reloginCount).toBe(0);
    expect(r.effects).toEqual(expect.arrayContaining([{ kind: 'openTab', url: 'SSO_URL' }]));
  });
  it('resets from a terminal core:"done" state too', () => {
    const stale = { ...st(), core: 'done', service: 'siap', tabId: 7 } as FlowState;
    const r = advance(stale, { type: 'REQUEST', mode: 'auto' }, { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } });
    expect(r.state.core).toBe('authing');
    expect(r.state.service).toBe('sso');
  });
  it('is a no-op while a flow is already active (no second tab)', () => {
    const r = advance(auth('sso'), { type: 'REQUEST', mode: 'auto' }, D);
    expect(r.state.core).toBe('authing');
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('preserves appTabId when resetting from a terminal state', () => {
    const stale = { ...st(), core: 'error', service: 'kulon', tabId: null, appTabId: 42 } as FlowState;
    const r = advance(stale, { type: 'REQUEST', mode: 'auto' }, { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } });
    expect(r.state.appTabId).toBe(42);
  });
});

describe('COOKIE_SET cascade (mode auto)', () => {
  it('sso → navigate kulon when the SSO session cookie actually changed', () => {
    const settled = { ...auth('sso'), settledAt: 1_000_000 - 5000 } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(['ci_session_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'KULON_URL' });
  });
  it('sso does NOT advance on a mere csrf/transient cookie change', () => {
    const r = advance(auth('sso'), COOKIE_SET(['csrf_cookie_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('sso ignores a real cookie event before the page has settled', () => {
    const s = { ...auth('sso'), settledAt: 0 } as FlowState;
    const r = advance(s, COOKIE_SET(['ci_session_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('kulon with siap → handoff', () => {
    const settled = { ...auth('kulon'), settledAt: 1_000_000 - 5000 } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(['MoodleSession']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('handoff');
  });
  it('kulon with siap ignores an LB/transient cookie change', () => {
    const r = advance(auth('kulon'), COOKIE_SET(['cookiesession1']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('authing');
    expect(r.effects).toEqual([]);
  });
  it('kulon without siap → navigate siap', () => {
    const settled = { ...auth('kulon'), settledAt: 1_000_000 - 5000 } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(['MoodleSession']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } });
    expect(r.state.service).toBe('siap');
  });
  it('siap → handoff when a SIAP session cookie changed', () => {
    const settled = { ...auth('siap'), settledAt: 1_000_000 - 5000 } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(['sia_app_session']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('handoff');
  });
  it('siap ignores a non-session cookie change', () => {
    const r = advance(auth('siap'), COOKIE_SET(['cookiesession1']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('authing');
  });
  describe('TAB_LOADED (load-gated fast path)', () => {
    it('TAB_LOADED advances kulon→handoff when hasKulon && hasSiap', () => {
      const r = advance(auth('kulon'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
      expect(r.state.core).toBe('handoff');
      expect(r.effects).toContainEqual({ kind: 'postHandoff' });
    });
    it('TAB_LOADED advances kulon→siap when hasKulon && !hasSiap', () => {
      const r = advance(auth('kulon'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } });
      expect(r.state.service).toBe('siap');
      expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'SIAP_URL' });
    });
    it('TAB_LOADED advances siap→handoff when hasSiap', () => {
      const r = advance(auth('siap'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
      expect(r.state.core).toBe('handoff');
    });
    it('TAB_LOADED settles but does NOT advance when the target cookie is absent', () => {
      const r = advance(auth('kulon'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.service).toBe('kulon');
      expect(r.effects).toEqual([]);
    });
    it('TAB_LOADED settles but does NOT fast-path advance in semi mode', () => {
      const r = advance(auth('kulon', 'semi'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.core).toBe('authing');
      expect(r.state.service).toBe('kulon');
      expect(r.effects).toEqual([]);
    });
    it('TAB_LOADED on sso only settles (no fast path — needs human login)', () => {
      const r = advance(auth('sso'), { type: 'TAB_LOADED' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.service).toBe('sso');
      expect(r.effects).toEqual([]);
    });
  });
});

describe('mode semi ignores COOKIE_SET, waits USER_DONE', () => {
  it('COOKIE_SET does not advance without USER_DONE even with a session-cookie payload', () => {
    const r = advance(auth('sso', 'semi'), COOKIE_SET(['ci_session_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('USER_DONE advances from sso', () => {
    const r = advance(auth('sso', 'semi'), { type: 'USER_DONE' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
  });
});

describe('handoff decisions', () => {
  it('HANDOFF_OK → done + sendResult ok', () => {
    const s = { ...st(), core: 'handoff', tabId: 7 } as FlowState;
    const r = advance(s, { type: 'HANDOFF_OK', token: 'jwt' }, D);
    expect(r.state.core).toBe('done');
    expect(r.effects).toContainEqual({ kind: 'sendResult', payload: { status: 'ok', accessToken: 'jwt' } });
    expect(r.effects).toContainEqual({ kind: 'clearTimers' });
  });
  it('HANDOFF_NEEDS_SERVICE:siap → authing:siap + clearCookies', () => {
    const s = { ...st(), core: 'handoff', tabId: 7 } as FlowState;
    const r = advance(s, { type: 'HANDOFF_NEEDS_SERVICE', service: 'siap' }, D);
    expect(r.state.core).toBe('authing');
    expect(r.state.service).toBe('siap');
    expect(r.effects).toContainEqual({ kind: 'clearCookies', service: 'siap' });
  });
  it('HANDOFF_STALE always re-auths sso in the SAME tab (no closeAllTabs; clear downstream + upstream)', () => {
    const s = { ...st(), core: 'handoff', tabId: 7, reloginCount: 0 } as FlowState;
    const r = advance(s, { type: 'HANDOFF_STALE' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } });
    expect(r.state.service).toBe('sso');
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).not.toContainEqual({ kind: 'closeAllTabs' });
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'SSO_URL' });
    // Presence of ci_session_sso does NOT prove SSO still live — stale cookies
    // were the whole problem, so the re-auth target must never assume hasSso.
    // Even with hasSso:true the target is sso, clearing the full chain.
    expect(r.effects).toContainEqual({ kind: 'clearCookies', service: 'sso' });
    expect(r.effects).toContainEqual({ kind: 'clearCookies', service: 'kulon' });
    expect(r.effects).toContainEqual({ kind: 'clearCookies', service: 'siap' });
  });
  it('HANDOFF_STALE without live SSO → re-auth sso in the same tab', () => {
    const r = advance({ ...st(), core: 'handoff', tabId: 7, reloginCount: 0 } as FlowState, { type: 'HANDOFF_STALE' }, D);
    expect(r.state.service).toBe('sso');
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'SSO_URL' });
  });
  it('HANDOFF_STALE without any tab yet → opens a new tab', () => {
    const r = advance({ ...st(), core: 'handoff', tabId: null, reloginCount: 0 } as FlowState, { type: 'HANDOFF_STALE' }, D);
    expect(r.effects).toContainEqual({ kind: 'openTab', url: 'SSO_URL' });
  });
  it('HANDOFF_STALE at MAX_RELOGIN → error', () => {
    const s = { ...st(), core: 'handoff', tabId: 7, reloginCount: 2 } as FlowState;
    const r = advance(s, { type: 'HANDOFF_STALE' }, D);
    expect(r.state.core).toBe('error');
  });
});

describe('TIMEOUT / CLOSE_ALL', () => {
  it('TIMEOUT → error', () => {
    const r = advance(auth('sso'), { type: 'TIMEOUT' }, D);
    expect(r.state.core).toBe('error');
    expect(r.effects).toContainEqual({ kind: 'clearTimers' });
  });
  it('CLOSE_ALL → idle', () => {
    const r = advance({ ...st(), core: 'handoff', tabId: 7 } as FlowState, { type: 'CLOSE_ALL' }, D);
    expect(r.state.core).toBe('idle');
    expect(r.effects).toContainEqual({ kind: 'closeAllTabs' });
  });
});

describe('attachTab', () => {
  it('adds tab id and tracks it in tabs[]', () => {
    const s = attachTab({ ...st(), core: 'authing', service: 'sso' }, 9);
    expect(s.tabId).toBe(9);
    expect(s.tabs).toContain(9);
  });
  it('does not duplicate an existing tab id', () => {
    const base = attachTab({ ...st(), core: 'authing', service: 'sso' }, 9);
    const again = attachTab(base, 9);
    expect(again.tabs).toEqual([9]);
  });
});

describe('normalizeState (zombie-flow recovery)', () => {
  const NOW = 2_000_000;
  it('keeps an idle state as-is', () => {
    expect(normalizeState(st(), NOW)).toEqual(st());
  });
  it('resets terminal done/error without a tab to idle', () => {
    expect(normalizeState({ ...st(), core: 'error', service: 'kulon', tabId: null } as FlowState, NOW).core).toBe('idle');
    expect(normalizeState({ ...st(), core: 'done', service: 'siap', tabId: null } as FlowState, NOW).core).toBe('idle');
  });
  it('keeps terminal state when a tab is still tracked (flow may be finishing)', () => {
    expect(normalizeState({ ...st(), core: 'done', service: 'siap', tabId: 7 } as FlowState, NOW).core).toBe('done');
  });
  it('resets a zombie authing flow whose deadline already passed (SW killed / extension reloaded)', () => {
    const zombie = { ...st(), core: 'authing', service: 'sso', tabId: 7, deadline: NOW - 1 } as FlowState;
    const r = normalizeState(zombie, NOW);
    expect(r.core).toBe('idle');
    expect(r.tabId).toBeNull();
  });
  it('resets a zombie handoff flow whose deadline already passed', () => {
    const zombie = { ...st(), core: 'handoff', service: null, tabId: 7, deadline: NOW - 1 } as FlowState;
    expect(normalizeState(zombie, NOW).core).toBe('idle');
  });
  it('keeps an ACTIVE authing flow whose deadline is still in the future', () => {
    const live = { ...st(), core: 'authing', service: 'sso', tabId: 7, deadline: NOW + 1000 } as FlowState;
    expect(normalizeState(live, NOW).core).toBe('authing');
  });
});

describe('load-gated COOKIE_SET + SSO guard', () => {
  it('real COOKIE_SET is ignored before the page settles (kulon)', () => {
    const r = advance(auth('kulon'), COOKIE_SET(['MoodleSession']), { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('authing');
    expect(r.effects).toEqual([]);
  });
  it('real COOKIE_SET is accepted after the page settles (sso → kulon)', () => {
    const settled = { ...auth('sso'), settledAt: 1_000_000 - 5000 } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(['ci_session_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'KULON_URL' });
  });
  it('sso skips a guest ci_session_sso within the post-settle guard', () => {
    const s = { ...auth('sso'), settledAt: 1_000_000 - 500 } as FlowState; // settled 500ms ago (< SSO_GUARD_MS)
    const r = advance(s, COOKIE_SET(['ci_session_sso']), { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('true poll forces settle on sso (bounded fallback) but does NOT advance', () => {
    const r = advance(auth('sso'), { type: 'COOKIE_SET', changed: undefined }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.settledAt).toBe(1_000_000);
    expect(r.state.service).toBe('sso');
    expect(r.effects).toEqual([]);
  });
  it('true poll advances kulon when hasKulon even if not settled', () => {
    const r = advance(auth('kulon'), { type: 'COOKIE_SET', changed: undefined }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('handoff');
  });
  it('USER_DONE (semi) advances even when not settled', () => {
    const r = advance(auth('sso', 'semi'), { type: 'USER_DONE' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
  });
});