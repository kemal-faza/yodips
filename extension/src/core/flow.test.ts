import { describe, it, expect } from 'vitest';
import { initialState, advance, attachTab, type FlowState, type FlowDeps } from './flow.js';

const LOGIN = { sso: 'SSO_URL', kulon: 'KULON_URL', siap: 'SIAP_URL' };
const D: FlowDeps = { flags: { hasSso: false, hasKulon: false, hasSiap: false }, now: () => 1_000_000, MAX_RELOGIN: 2, PHASE_TIMEOUT_MS: 1000, loginUrl: (s) => LOGIN[s] };

function st(mode: 'auto' | 'semi' = 'auto'): FlowState {
  return initialState(mode);
}

function auth(svc: FlowState['service'], mode: 'auto' | 'semi' = 'auto', tabId = 7): FlowState {
  return { ...st(mode), core: 'authing', service: svc, tabId };
}

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
    expect(r.effects).toContainEqual({ kind: 'postHandoff' });
  });
});

describe('COOKIE_SET cascade (mode auto)', () => {
  it('sso → navigate kulon', () => {
    const r = advance(auth('sso'), { type: 'COOKIE_SET' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'KULON_URL' });
  });
  it('kulon with siap → handoff', () => {
    const r = advance(auth('kulon'), { type: 'COOKIE_SET' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } });
    expect(r.state.core).toBe('handoff');
  });
  it('kulon without siap → navigate siap', () => {
    const r = advance(auth('kulon'), { type: 'COOKIE_SET' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } });
    expect(r.state.service).toBe('siap');
  });
});

describe('mode semi ignores COOKIE_SET, waits USER_DONE', () => {
  it('COOKIE_SET does not advance without USER_DONE', () => {
    const r = advance(auth('sso', 'semi'), { type: 'COOKIE_SET' }, { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } });
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
  it('HANDOFF_STALE with live SSO → re-auth kulon in the SAME tab (no closeAllTabs, no sso clear)', () => {
    const s = { ...st(), core: 'handoff', tabId: 7, reloginCount: 0 } as FlowState;
    const r = advance(s, { type: 'HANDOFF_STALE' }, { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } });
    expect(r.state.service).toBe('kulon');
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).not.toContainEqual({ kind: 'closeAllTabs' });
    expect(r.effects).toContainEqual({ kind: 'navigateTab', url: 'KULON_URL' });
    // down gust downstream kulon+siap — the live SSO cookie must survive
    expect(r.effects).toContainEqual({ kind: 'clearCookies', service: 'kulon' });
    expect(r.effects).not.toContainEqual({ kind: 'clearCookies', service: 'sso' });
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