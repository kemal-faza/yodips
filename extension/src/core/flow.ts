import type { CookieFlags, FlowMode, OutboundStatus, Service } from './contract.js';
import { phasesToClear } from './cookies.js';

export interface FlowState {
  core: 'idle' | 'authing' | 'handoff' | 'done' | 'error';
  service: Service | null;
  tabId: number | null;
  tabs: number[];
  appTabId: number | null;
  deadline: number;
  reloginCount: number;
  mode: FlowMode;
}

export type FlowEvent =
  | { type: 'REQUEST'; mode: FlowMode }
  | { type: 'COOKIE_SET' }
  | { type: 'TAB_LOADED' }
  | { type: 'HANDOFF_OK'; token: string }
  | { type: 'HANDOFF_NEEDS_SERVICE'; service: Service }
  | { type: 'HANDOFF_STALE' }
  | { type: 'HANDOFF_ERROR'; message: string }
  | { type: 'TIMEOUT' }
  | { type: 'USER_DONE' }
  | { type: 'CLOSE_ALL' };

export interface FlowDeps {
  flags: CookieFlags;
  now: () => number;
  MAX_RELOGIN: number;
  PHASE_TIMEOUT_MS: number;
  loginUrl: (s: Service) => string;
}

export type FlowEffect =
  | { kind: 'openTab'; url: string }
  | { kind: 'navigateTab'; url: string }
  | { kind: 'closeAllTabs' }
  | { kind: 'clearCookies'; service: Service }
  | { kind: 'postHandoff' }
  | { kind: 'sendResult'; payload: OutboundStatus }
  | { kind: 'scheduleTimers'; deadline: number }
  | { kind: 'clearTimers' }
  | { kind: 'focusAppTab' };

export function initialState(mode: FlowMode = 'auto'): FlowState {
  return { core: 'idle', service: null, tabId: null, tabs: [], appTabId: null, deadline: 0, reloginCount: 0, mode };
}

export function attachTab(state: FlowState, tabId: number): FlowState {
  return { ...state, tabId, tabs: state.tabs.includes(tabId) ? state.tabs : [...state.tabs, tabId] };
}

export function redact(state: FlowState): { core: string; phase: string | null; tabId: number | null } {
  return { core: state.core, phase: state.service, tabId: state.tabId };
}

function deadline(deps: FlowDeps): number {
  return deps.now() + deps.PHASE_TIMEOUT_MS;
}

function clearFor(service: Service): FlowEffect[] {
  return phasesToClear(service).map((s) => ({ kind: 'clearCookies' as const, service: s }));
}

export function advance(
  state: FlowState,
  event: FlowEvent,
  deps: FlowDeps,
): { state: FlowState; effects: FlowEffect[] } {
  const { flags } = deps;

  if (event.type === 'CLOSE_ALL') {
    return { state: initialState(state.mode), effects: [{ kind: 'clearTimers' }, { kind: 'closeAllTabs' }] };
  }

  if (event.type === 'REQUEST' && state.core === 'idle') {
    if (!flags.hasKulon) {
      return {
        state: { ...initialState(event.mode), mode: event.mode, core: 'authing', service: 'sso', deadline: deadline(deps) },
        effects: [
          ...clearFor('sso'),
          { kind: 'openTab', url: deps.loginUrl('sso') },
          { kind: 'scheduleTimers', deadline: deadline(deps) },
        ],
      };
    }
    return { state: { ...initialState(event.mode), mode: event.mode, core: 'handoff' }, effects: [{ kind: 'postHandoff' }] };
  }

  if (event.type === 'TIMEOUT' && (state.core === 'authing' || state.core === 'handoff')) {
    return {
      state: { ...state, core: 'error' },
      effects: [
        { kind: 'clearTimers' },
        { kind: 'closeAllTabs' },
        { kind: 'sendResult', payload: { status: 'error', message: 'Login belum selesai dalam batas waktu. Silakan klik "Login via Extension" lagi.' } },
      ],
    };
  }

  if (state.core === 'authing' && (event.type === 'COOKIE_SET' || event.type === 'USER_DONE')) {
    const triggered = state.mode === 'semi' ? event.type === 'USER_DONE' : event.type === 'COOKIE_SET';
    if (!triggered) return { state, effects: [] };

    const svc = state.service;
    if (svc === 'sso') {
      if (!flags.hasSso) return { state, effects: [] };
      return {
        state: { ...state, service: 'kulon', deadline: deadline(deps) },
        effects: [
          { kind: 'navigateTab', url: deps.loginUrl('kulon') },
          { kind: 'scheduleTimers', deadline: deadline(deps) },
        ],
      };
    }
    if (svc === 'kulon') {
      if (!flags.hasKulon) return { state, effects: [] };
      if (!flags.hasSiap) {
        return {
          state: { ...state, service: 'siap', deadline: deadline(deps) },
          effects: [
            { kind: 'navigateTab', url: deps.loginUrl('siap') },
            { kind: 'scheduleTimers', deadline: deadline(deps) },
          ],
        };
      }
      return { state: { ...state, core: 'handoff' }, effects: [{ kind: 'postHandoff' }] };
    }
    // svc === 'siap'
    if (!flags.hasSiap) return { state, effects: [] };
    return { state: { ...state, core: 'handoff' }, effects: [{ kind: 'postHandoff' }] };
  }

  if (state.core === 'handoff') {
    switch (event.type) {
      case 'HANDOFF_OK':
        return {
          state: { ...state, core: 'done' },
          effects: [
            { kind: 'clearTimers' },
            { kind: 'sendResult', payload: { status: 'ok', accessToken: event.token } },
            { kind: 'closeAllTabs' },
            { kind: 'focusAppTab' },
          ],
        };
      case 'HANDOFF_NEEDS_SERVICE':
        return {
          state: { ...state, core: 'authing', service: event.service, deadline: deadline(deps) },
          effects: [
            ...clearFor(event.service),
            { kind: 'navigateTab', url: deps.loginUrl(event.service) },
            { kind: 'scheduleTimers', deadline: deadline(deps) },
          ],
        };
      case 'HANDOFF_STALE': {
        if (state.reloginCount < deps.MAX_RELOGIN) {
          // The Kulon session was rejected as stale (KULON_STALE). If the
          // central Kazan SSO session is still live, re-establish Kulon
          // DIRECTLY — the SSO session auto-propagates into a fresh Kulon
          // session, and reopening the SSO page would change no cookie
          // (deadlock until timeout). Only when SSO itself is gone do we
          // re-auth from the root. Reuse the SAME login tab (navigate, not
          // closeAllTabs+openTab) so the user never sees the tab slam shut.
          const target: Service = flags.hasSso ? 'kulon' : 'sso';
          const nav: FlowEffect =
            state.tabId != null
              ? { kind: 'navigateTab', url: deps.loginUrl(target) }
              : { kind: 'openTab', url: deps.loginUrl(target) };
          return {
            state: {
              ...state,
              core: 'authing',
              service: target,
              reloginCount: state.reloginCount + 1,
              deadline: deadline(deps),
            },
            effects: [
              ...clearFor(target),
              nav,
              { kind: 'scheduleTimers', deadline: deadline(deps) },
            ],
          };
        }
        return {
          state: { ...state, core: 'error' },
          effects: [
            { kind: 'clearTimers' },
            { kind: 'closeAllTabs' },
            { kind: 'sendResult', payload: { status: 'error', message: 'Sesi layanan gagal diperbarui. Silakan coba lagi.' } },
          ],
        };
      }
      case 'HANDOFF_ERROR':
        return {
          state: { ...state, core: 'error' },
          effects: [
            { kind: 'clearTimers' },
            { kind: 'closeAllTabs' },
            { kind: 'sendResult', payload: { status: 'error', message: event.message } },
          ],
        };
      default:
        return { state, effects: [] };
    }
  }

  return { state, effects: [] };
}