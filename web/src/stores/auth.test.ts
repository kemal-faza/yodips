import { beforeEach, describe, expect, it, vi } from 'vitest';

// vitest 4 removed the flushPromises export; provide it locally so we can drain
// the microtask queue after advancing fake timers. Pure microtask (no timers) so
// it also works while vi.useFakeTimers() is active.
function flushPromises(): Promise<void> {
  return Promise.resolve();
}
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';
import { beginLogout, endLogout, isLogoutInProgress, getReauthEpoch } from '../lib/logout';
import * as api from '../api/client';
import { EXTENSION_ID } from '../config/extension';
import * as cache from '../api/cache';

vi.mock('../api/client', () => ({
  capture: vi.fn(),
  me: vi.fn(),
  getSiapProfile: vi.fn().mockResolvedValue(null),
  logoutSession: vi.fn().mockResolvedValue(undefined),
}));

// Test env has no VITE_EXTENSION_ID; give the store a stable non-empty ID so the
// sendToExtension guard passes and messages reach the stubbed chrome.runtime.
vi.mock('../config/extension', () => ({ EXTENSION_ID: 'test-extension-id' }));

// vi.hoisted factory references that per-test overrides can control.
const extMockState = vi.hoisted(() => ({
  logoutImpl: undefined as undefined | (() => Promise<void>),
  logoutMock: undefined as undefined | ReturnType<typeof vi.fn>,
}));

// Mock useExtension: delegate EVERY method to the real module (existing suites
// stub globalThis.chrome and expect real sendHandoff/readStatus/sendDone
// behavior) EXCEPT logout, which defaults to the real module's logout unless a
// test overrides it via extMockState.logoutImpl. The SAME mocked useExtension
// instance is shared by the store and the test.
vi.mock('../composables/useExtension', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useExtension')>();
  const extLogout = vi.fn((...args: Parameters<typeof actual.useExtension extends () => infer R ? (R extends { logout: infer L } ? L : never) : never>) =>
    extMockState.logoutImpl
      ? extMockState.logoutImpl(...args)
      : actual.useExtension().logout(...args),
  );
  extMockState.logoutMock = extLogout;
  return {
    useExtension: () => {
      const api = actual.useExtension();
      return { ...api, logout: extLogout };
    },
  };
});
import { useExtension } from '../composables/useExtension';

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('login stores token and sets authenticated', async () => {
    (api.capture as any).mockResolvedValue({
      accessToken: 'jwt-1', capturedAt: 0, hasSso: true, hasMicrosoft: true, hasKulon: true,
    });
    const store = useAuthStore();
    await store.login();
    expect(store.token).toBe('jwt-1');
    expect(store.isAuthenticated).toBe(true);
    expect(localStorage.getItem('sso_token')).toBe('jwt-1');
  });

  it('login sets error when capture fails', async () => {
    (api.capture as any).mockRejectedValue(new Error('SSO session not found'));
    const store = useAuthStore();
    await store.login();
    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toContain('Gagal login');
  });

  it('login shows a clear message on 429 (rate limit)', async () => {
    (api.capture as any).mockRejectedValue({ response: { status: 429 } });
    const store = useAuthStore();
    await store.login();
    expect(store.token).toBeNull();
    expect(store.error).not.toContain('Request failed with status code 429');
    expect(store.error).toContain('Terlalu banyak percobaan');
  });

  it('logout clears token', async () => {
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.token = 'x';
    await store.logout();
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('logout notifies the extension to clear session cookies (best-effort)', async () => {
    let sentAction: string | null = null;
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          sentAction = msg?.action ?? null;
          cb({ status: 'ok' });
        },
      },
    };
    const store = useAuthStore();
    store.token = 'x';
    await store.logout();
    expect(sentAction).toBe('logout');
    delete (globalThis as any).chrome;
  });

  it('logout clears the shared cache', async () => {
    const spy = vi.spyOn(cache, 'clearCache');
    const store = useAuthStore();
    await store.logout();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logout does not throw when the extension is not installed', async () => {
    const store = useAuthStore();
    store.token = 'x';
    await store.logout();
    expect(store.token).toBeNull();
  });
  it('finishHandoff stores the token and authenticates', () => {
    const store = useAuthStore();
    store.finishHandoff('jwt-handoff');
    expect(store.token).toBe('jwt-handoff');
    expect(store.isAuthenticated).toBe(true);
    expect(localStorage.getItem('sso_token')).toBe('jwt-handoff');
  });

  it('fetchMe returns ok and sets flags when the session is complete', async () => {
    (api.me as any).mockResolvedValue({
      sub: 'n', authenticated: true, hasSso: true, hasMicrosoft: false,
      hasKulon: true, hasSiap: true, complete: true,
    });
    const store = useAuthStore();
    const status = await store.fetchMe();
    expect(status).toBe('ok');
    expect(store.user).toEqual(expect.objectContaining({ sub: 'n', complete: true }));
    expect(store.hasSiap).toBe(true);
    expect(store.hasKulon).toBe(true);
  });

  it('fetchMe returns incomplete, wipes the token and does not keep user on incomplete session', async () => {
    localStorage.setItem('sso_token', 'jwt-x');
    (api.me as any).mockResolvedValue({
      sub: 'n', authenticated: true, hasSso: false, hasMicrosoft: false,
      hasKulon: false, hasSiap: false, complete: false,
    });
    const store = useAuthStore();
    store.token = 'jwt-x';
    const status = await store.fetchMe();
    expect(status).toBe('incomplete');
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('fetchMe returns error and keeps the token on network failure', async () => {
    localStorage.setItem('sso_token', 'jwt-x');
    (api.me as any).mockRejectedValue(new Error('Network Error')); // no response.status
    const store = useAuthStore();
    store.token = 'jwt-x';
    const status = await store.fetchMe();
    expect(status).toBe('error');
    expect(store.token).toBe('jwt-x');
    expect(localStorage.getItem('sso_token')).toBe('jwt-x');
  });

  it('fetchMe returns invalid on 401', async () => {
    (api.me as any).mockRejectedValue({ response: { status: 401 } });
    const store = useAuthStore();
    const status = await store.fetchMe();
    expect(status).toBe('invalid');
  });

  it('fetchMe loads the SIAP photo when hasSiap is true', async () => {
    (api.me as any).mockResolvedValue({
      sub: 'n', authenticated: true, hasSso: true, hasMicrosoft: false,
      hasKulon: true, hasSiap: true, complete: true,
    });
    (api.getSiapProfile as any).mockResolvedValue({ fotoUrl: 'https://disk.undip.ac.id/ktm.jpg', nama: 'Budi' });
    const store = useAuthStore();
    await store.fetchMe();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.fotoUrl).toBe('https://disk.undip.ac.id/ktm.jpg');
    expect(api.getSiapProfile).toHaveBeenCalled();
  });

  it('fetchMe clears fotoUrl via logout when session is incomplete (no SIAP)', async () => {
    (api.me as any).mockResolvedValue({
      sub: 'n', authenticated: true, hasSso: true, hasMicrosoft: false,
      hasKulon: false, hasSiap: false, complete: false,
    });
    const store = useAuthStore();
    store.fotoUrl = 'https://example.com/old.jpg';
    await store.fetchMe();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.getSiapProfile).not.toHaveBeenCalled();
    expect(store.fotoUrl).toBeNull();
  });

  it('logout clears fotoUrl', async () => {
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.fotoUrl = 'https://example.com/x.jpg';
    await store.logout();
    expect(store.fotoUrl).toBeNull();
  });

  it('logout calls the server logout endpoint best-effort before local cleanup', async () => {
    (api.logoutSession as any).mockClear();
    localStorage.setItem('sso_token', 'jwt-logout');
    const store = useAuthStore();
    store.token = 'jwt-logout';
    await store.logout();
    expect(api.logoutSession).toHaveBeenCalledTimes(1);
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('logout swallows a server logout failure and ALWAYS completes local cleanup', async () => {
    (api.logoutSession as any).mockRejectedValue(new Error('network down'));
    localStorage.setItem('sso_token', 'jwt-logout');
    const store = useAuthStore();
    store.token = 'jwt-logout';
    store.user = { sub: 'n', nama: 'X' } as any;
    await expect(store.logout()).resolves.toBeUndefined();
    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('logout clears the token locally even when the server logout 401s (session already dead)', async () => {
    (api.logoutSession as any).mockRejectedValue({ response: { status: 401 } });
    localStorage.setItem('sso_token', 'jwt-logout');
    const store = useAuthStore();
    store.token = 'jwt-logout';
    await store.logout();
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('logout does not call the server when there is no local JWT', async () => {
    (api.logoutSession as any).mockClear();
    const store = useAuthStore();
    store.token = null;
    await store.logout();
    expect(api.logoutSession).not.toHaveBeenCalled();
  });

  it('logout resolves only AFTER the extension cookie-wipe promise settles (fire-and-forget race)', async () => {
    // The extension wipe is async; logout() must await it before resolving, so
    // navigation/UI teardown after `await store.logout()` cannot race the
    // cookie clear. Track settlement via a flag flipped by a microtask chained
    // onto the extension logout promise.
    let extensionLogoutSettled = false;
    let extResolve: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      extResolve = resolve;
    });
    const extensionLogoutPromise = gate.then(() => {
      extensionLogoutSettled = true;
    });
    extMockState.logoutImpl = () => extensionLogoutPromise;
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.token = 'x';
    const logoutPromise = store.logout();
    let logoutSettled = false;
    void logoutPromise.then(() => {
      logoutSettled = true;
    });
    // Drain pending microtasks so logout() reaches the extension await.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    // Logout must NOT have resolved while the extension wipe is still pending.
    expect(logoutSettled).toBe(false);
    // Settle the extension wipe → logout resolves after it.
    extResolve();
    await logoutPromise;
    expect(extensionLogoutSettled).toBe(true);
    expect(logoutSettled).toBe(true);
  });

  it('isHandoffMode reflects VITE_LOGIN_MODE', () => {
    vi.stubEnv('VITE_LOGIN_MODE', 'handoff');
    const store = useAuthStore();
    expect(store.isHandoffMode).toBe(true);
    vi.unstubAllEnvs();
  });

  // File-scoped drain: the logout module's flag is module state (not Pinia),
  // so vi.clearAllMocks()/localStorage.clear() do not reset it. Every test
  // above pairs its beginLogout() with endLogout(), but a failed assertion
  // mid-test would leak the flag into the next test — this idempotent drain
  // makes the whole file robust to that.
  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
  });

  it('logout raises the flag synchronously (before its first await) and releases it only after the extension wipe settles', async () => {
    // Boundary contract the interceptor relies on: a sibling 401 that reaches
    // the interceptor AFTER logout() was called (even synchronously) must see
    // the flag up. logout() must therefore raise the flag before ANY await.
    // Shape mirrors the proven pattern of the pre-existing fire-and-forget
    // race test (gated extension wipe).
    let flagStateAtRevoke = false;
    (api.logoutSession as any).mockImplementation(async () => {
      // While the server revoke is in flight (first await inside logout),
      // a sibling 401 arriving NOW must be suppressed:
      flagStateAtRevoke = isLogoutInProgress();
    });
    let extResolve: () => void = () => {};
    const extGate = new Promise<void>((resolve) => { extResolve = resolve; });
    extMockState.logoutImpl = () => extGate;
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.token = 'x';
    const logoutPromise = store.logout();
    let logoutSettled = false;
    void logoutPromise.then(() => { logoutSettled = true; });
    // Drain pending microtasks so logout() reaches the extension await.
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    expect(flagStateAtRevoke).toBe(true); // flag was up during the server revoke
    expect(logoutSettled).toBe(false); // not resolved while the wipe is pending
    expect(isLogoutInProgress()).toBe(true); // flag STILL held during the wipe
    extResolve(); // settle the extension wipe → logout resolves after it
    await logoutPromise;
    expect(logoutSettled).toBe(true);
    expect(isLogoutInProgress()).toBe(false); // released only after the wipe
    extMockState.logoutImpl = undefined;
    (api.logoutSession as any).mockResolvedValue(undefined); // restore default
  });

  it('logout is idempotent under concurrency: a second logout() early-returns and cleanup runs once', async () => {
    let serverCalls = 0;
    (api.logoutSession as any).mockImplementation(async () => { serverCalls += 1; });
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.token = 'x';
    const p1 = store.logout();
    const p2 = store.logout(); // second call while first is in flight
    await Promise.all([p1, p2]);
    // The shared in-flight operation performs a single cleanup (one server
    // call, one wipe); the second call early-returns.
    expect(serverCalls).toBe(1);
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
    expect(isLogoutInProgress()).toBe(false);
    (api.logoutSession as any).mockResolvedValue(undefined); // restore default
  });

  it('logout does not resolve until the bounded server revoke and extension wipe have settled, then releases the flag', async () => {
    // Ordering + flag-release regression: the revoke is attempted BEFORE local
    // cleanup, the extension wipe is awaited BEFORE endLogout() releases the
    // flag (the design forbids endLogout() preceding the wipe response).
    const order: string[] = [];
    (api.logoutSession as any).mockImplementation(async () => { order.push('server'); });
    const extGate = new Promise<void>((res) => { setTimeout(res, 0); });
    extMockState.logoutImpl = async () => { await extGate; order.push('ext-wipe'); };
    localStorage.setItem('sso_token', 'x');
    const store = useAuthStore();
    store.token = 'x';
    const p = store.logout();
    await flushPromises();
    // The flag must STILL be held while the extension wipe is pending.
    expect(isLogoutInProgress()).toBe(true);
    await extGate;
    await p;
    order.push('done');
    expect(order).toEqual(['server', 'ext-wipe', 'done']);
    expect(isLogoutInProgress()).toBe(false); // endLogout() in finally, after the wipe
    expect(localStorage.getItem('sso_token')).toBeNull();
    expect(extMockState.logoutMock).toHaveBeenCalledTimes(1);
    extMockState.logoutImpl = undefined;
    (api.logoutSession as any).mockResolvedValue(undefined); // restore default
  });

  it('the bounded server revoke does not extend past cleanup: a hung revoke times out and cleanup still runs', async () => {
    // Server revoke is raced against a short settle window; a hang must not
    // block the local wipe or the flag release.
    vi.useFakeTimers();
    (api.logoutSession as any).mockImplementation(
      () => new Promise(() => {}), // never settles
    );
    const store = useAuthStore();
    store.token = 'x';
    const p = store.logout();
    await vi.advanceTimersByTimeAsync(6000); // past the ~5s bound
    await flushPromises();
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
    await p;
    expect(isLogoutInProgress()).toBe(false);
    vi.useRealTimers();
    extMockState.logoutImpl = undefined;
    (api.logoutSession as any).mockResolvedValue(undefined); // restore default
  }, 10000);
});

describe('extension login', () => {
  function stubChrome(status: 'ok' | 'started' | 'error' | 'throw', accessToken?: string) {
    (globalThis as any).chrome = {
      runtime: {
        lastError: status === 'throw' ? { message: 'Could not establish connection' } : null,
        sendMessage: (id: string, msg: any, cb: (resp: any) => void) => {
          expect(id).toBe(EXTENSION_ID);
          if (status === 'throw') {
            // Real chrome: no receiver -> callback fires with runtime.lastError set.
            cb(undefined);
            return;
          }
          cb(status === 'ok' ? { status: 'ok', accessToken } : { status });
        },
      },
    };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete (globalThis as any).chrome;
  });

  it('reports not extension installed when chrome missing', async () => {
    const store = useAuthStore();
    expect(await store.isExtensionInstalled()).toBe(false);
    expect(await store.loginViaExtension()).toBe('not-installed');
  });

  it('reports not installed and does not crash on sendMessage throw', async () => {
    stubChrome('throw');
    const store = useAuthStore();
    expect(await store.isExtensionInstalled()).toBe(false);
    expect(store.extensionError).toContain('Extension tidak terdeteksi');
    expect(await store.loginViaExtension()).toBe('not-installed');
    expect(store.token).toBeNull();
  });

  it('detects extension via ping', async () => {
    stubChrome('ok', 'jwt');
    const store = useAuthStore();
    expect(await store.isExtensionInstalled()).toBe(true);
  });

  it('loginViaExtension stores token and returns ok', async () => {
    stubChrome('ok', 'jwt-ext');
    const store = useAuthStore();
    expect(await store.loginViaExtension()).toBe('ok');
    expect(store.token).toBe('jwt-ext');
    expect(localStorage.getItem('sso_token')).toBe('jwt-ext');
  });

  it('loginViaExtension returns started (background drives the rest)', async () => {
    stubChrome('started');
    const store = useAuthStore();
    store.error = 'old';
    expect(await store.loginViaExtension()).toBe('started');
    expect(store.error).toBeNull();
    expect(store.token).toBeNull();
  });

  it('loginViaExtension returns error on handoff failure', async () => {
    stubChrome('error');
    const store = useAuthStore();
    expect(await store.loginViaExtension()).toBe('error');
    expect(store.token).toBeNull();
  });

  it('onExtensionResult forwards the extension window message payload to the handler', async () => {
    const store = useAuthStore();
    const handler = vi.fn();
    const cleanup = store.onExtensionResult(handler);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'undip-sso-extension', payload: { status: 'ok', accessToken: 'jwt-msg' } },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledWith({ status: 'ok', accessToken: 'jwt-msg' });
    cleanup();
  });

  it('onExtensionResult ignores messages from other sources', async () => {
    const store = useAuthStore();
    const handler = vi.fn();
    const cleanup = store.onExtensionResult(handler);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'other-app', payload: { status: 'ok', accessToken: 'x' } },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).not.toHaveBeenCalled();
    cleanup();
  });

  it('readExtensionResult returns the ok payload from the extension result poll', async () => {
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          expect(msg.action).toBe('status');
          cb({ status: 'ok', accessToken: 'jwt-poll' });
        },
      },
    };
    const store = useAuthStore();
    const res = await store.readExtensionResult();
    expect(res).toEqual({ status: 'ok', accessToken: 'jwt-poll' });
  });

  it('readExtensionResult returns the poll state when the flow is still active', async () => {
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, _msg: any, cb: (resp: any) => void) =>
          cb({ status: 'ok', active: true, phase: 'sso' }),
      },
    };
    const store = useAuthStore();
    expect(await store.readExtensionResult()).toEqual({ status: 'ok', active: true, phase: 'sso' });
  });

  it('readExtensionResult resolves null when the extension is not installed', async () => {
    const store = useAuthStore();
    expect(await store.readExtensionResult()).toBeNull();
  });
});

describe('reauth (auto-recover expired session)', () => {
  function stubChrome(status: 'ok' | 'started' | 'error' | 'throw', accessToken?: string) {
    (globalThis as any).chrome = {
      runtime: {
        lastError: status === 'throw' ? { message: 'no receiver' } : null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (status === 'throw') { cb(undefined); return; }
          cb(status === 'ok' ? { status: 'ok', accessToken } : { status });
        },
      },
    };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete (globalThis as any).chrome;
    vi.clearAllMocks();
  });

  it('fetchMe on incomplete clears JWT+fotoUrl but does NOT call logout (cookies kept)', async () => {
    (api.me as any).mockResolvedValue({
      sub: 'n', authenticated: true, hasSso: true, hasMicrosoft: false,
      hasKulon: false, hasSiap: false, complete: false,
    });
    const store = useAuthStore();
    store.token = 'jwt-x';
    store.fotoUrl = 'https://example.com/old.jpg';
    const spyLogout = vi.spyOn(store, 'logout');
    const status = await store.fetchMe();
    expect(status).toBe('incomplete');
    expect(store.token).toBeNull();
    expect(store.fotoUrl).toBeNull();
    expect(spyLogout).not.toHaveBeenCalled();
  });

  it('attemptReauth returns recovered and stores token when extension fast-path ok', async () => {
    stubChrome('ok', 'jwt-reauth');
    const store = useAuthStore();
    expect(await store.attemptReauth()).toBe('recovered');
    expect(store.token).toBe('jwt-reauth');
  });

  it('attemptReauth returns failed and does not loop when extension absent', async () => {
    const store = useAuthStore();
    expect(await store.attemptReauth()).toBe('failed');
    expect(await store.attemptReauth()).toBe('failed'); // loop guard
  });

  it('attemptReauth returns failed when loginViaExtension errors', async () => {
    stubChrome('error');
    const store = useAuthStore();
    expect(await store.attemptReauth()).toBe('failed');
  });

  it('attemptReauth returns failed when called twice (loop guard), then resets on logout', async () => {
    stubChrome('ok', 'jwt-a');
    const store = useAuthStore();
    expect(await store.attemptReauth()).toBe('recovered');
    await store.logout(); // genuine logout resets guard + clears cookies
    store.token = null;
    stubChrome('ok', 'jwt-b');
    expect(await store.attemptReauth()).toBe('recovered');
    expect(store.token).toBe('jwt-b');
  });

  it('attemptReauth on started polls readStatus until ok and reports phases', async () => {
    vi.useFakeTimers();
    const statusSteps = [
      { status: 'ok', active: true, phase: 'sso' },
      { status: 'ok', active: true, phase: 'kulon' },
      { status: 'ok', accessToken: 'jwt-poll' },
    ];
    let n = 0;
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          return cb(statusSteps[Math.min(n++, 2)]);
        },
      },
    };
    const store = useAuthStore();
    const seen: string[] = [];
    const promise = store.attemptReauth((p) => seen.push(p));
    await vi.advanceTimersByTimeAsync(0);  // immediate attempt() -> sso
    await vi.advanceTimersByTimeAsync(3000); // interval -> kulon
    await vi.advanceTimersByTimeAsync(3000); // interval -> ok(token) -> resolves
    await flushPromises();
    expect(seen).toContain('sso');
    expect(seen).toContain('kulon');
    expect(await promise).toBe('recovered');
    expect(store.token).toBe('jwt-poll');
    vi.useRealTimers();
  }, 10000);

  it('token is updated via setToken after a silent refresh', async () => {
    const { useAuthStore } = await import('./auth');
    const store = useAuthStore();
    store.setToken('new-jwt');
    expect(store.token).toBe('new-jwt');
  });

  it('attemptReauth returns failed during logout (never mints)', async () => {
    stubChrome('ok', 'jwt-during-logout'); // extension would answer ok
    const store = useAuthStore();
    store.token = 'x';
    beginLogout();
    try {
      expect(await store.attemptReauth()).toBe('failed');
      expect(store.token).toBe('x'); // no mint, no store write
    } finally {
      endLogout();
    }
  });

  it('attemptReauth that started BEFORE logout but whose handoff resolves ok AFTER logout began returns failed and does not mint', async () => {
    // Mid-flight edge: attemptReauth passed the entry guard, then a logout
    // BEGAN while loginViaExtension() was awaiting; the extension answers ok
    // with a fresh token. The post-await epoch check must return 'failed' and
    // the finishHandoff write gate must block the mint. Drive logout's begin
    // via the real store.logout() so the wipe is real (token → null).
    let releaseHandoff!: () => void;
    const handoffGate = new Promise<any>((resolve) => {
      releaseHandoff = () => resolve({ status: 'ok', accessToken: 'jwt-raced' });
    });
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') {
            handoffGate.then(cb); // extension answers ok only when released
          } else {
            cb({ status: 'ok' }); // logout wipe + anything else resolve
          }
        },
      },
    };
    const store = useAuthStore();
    store.token = 'x';
    const reauthPromise = store.attemptReauth(); // passes entry guard, awaits handoff
    await flushPromises();
    const logoutPromise = store.logout(); // begins while the handoff is in flight
    releaseHandoff(); // extension now answers ok — must NOT mint
    expect(await reauthPromise).toBe('failed'); // post-await epoch re-check
    await logoutPromise; // let the wipe finish before asserting final state
    expect(store.token).toBeNull(); // logout wiped; the raced mint was blocked
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('logout cancels an ALREADY-RUNNING waitForReauthResult poll: late extension ok never resurrects the token, reauth state resets', async () => {
    // The resurrection hole (reviewer finding): attemptReauth('started') is
    // running a 3s waitForReauthResult poll when logout() begins. The poll's
    // next tick must see the bumped epoch and settle 'failed' WITHOUT calling
    // finishHandoff — even though the extension would answer ok with a fresh
    // accessToken — and logout must clear reauthing/reauthPhase so the overlay
    // does not linger. The extension wipe is GATED so the poll tick fires while
    // logout is genuinely in flight (mirrors the race test in 'auth store').
    const store = useAuthStore();
    store.token = 'x';
    store.reauthing = true; // overlay up (attemptReauth set it)
    store.reauthPhase = 'sso';
    const epochBefore = getReauthEpoch();
    vi.useFakeTimers(); // drive the poll interval deterministically
    // statusSteps: the FIRST readStatus (inside waitForReauthResult's immediate
    // attempt()) returns an in-progress phase so the poll keeps waiting; the
    // SECOND readStatus (after logout bumps the epoch) would return ok+token —
    // the poll must NOT act on it (reads stays 1).
    let reads = 0;
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          if (msg?.action === 'logout') return cb({ status: 'ok' }); // ext wipe — NOT a status read
          reads += 1;
          if (reads === 1) return cb({ status: 'ok', active: true, phase: 'sso' });
          return cb({ status: 'ok', accessToken: 'jwt-resurrected' }); // late ok
        },
      },
    };
    // Gate the extension wipe so logout stays in flight until we release it:
    let releaseWipe!: () => void;
    const wipeGate = new Promise<void>((resolve) => { releaseWipe = resolve; });
    extMockState.logoutImpl = () => wipeGate;
    const pollPromise = store.waitForReauthResult(); // already running (no logout yet)
    await vi.advanceTimersByTimeAsync(0); // immediate attempt() -> phase sso, still waiting
    await flushPromises();
    expect(store.reauthing).toBe(true);
    expect(reads).toBe(1);
    // Logout starts WHILE the poll is running; it reaches the gated extension
    // wipe and stops — flag up, epoch bumped, wipe pending:
    const logoutPromise = store.logout();
    // Drain the logout chain: logoutSession (Promise.race) → local wipe →
    // useExtension().logout() → wipeGate. Under fake timers the async chain
    // still runs on microtasks; flush them, then let macrotask-queued steps
    // (the race timeout) advance.
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(isLogoutInProgress()).toBe(true); // still in flight (wipe gated)
    expect(store.token).toBeNull(); // local wipe ran before the gated wipe
    expect(store.reauthing).toBe(false); // logout reset the overlay state
    // The poll's next tick fires NOW, mid-logout:
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(reads).toBe(1); // the invalidated tick never called readExtensionResult
    expect(await pollPromise).toBe('failed'); // self-cancelled, never 'recovered'
    // The local wipe ran before the (gated) extension wipe, so the token is
    // already null — the late-ok tick must NOT have resurrected it:
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
    expect(store.reauthing).toBe(false); // overlay torn down by the settle
    expect(store.reauthPhase).toBeNull();
    // Release the wipe → logout completes endLogout():
    releaseWipe();
    await logoutPromise;
    expect(isLogoutInProgress()).toBe(false);
    expect(getReauthEpoch()).toBeGreaterThan(epochBefore); // logout bumped it
    extMockState.logoutImpl = undefined;
    vi.useRealTimers();
  }, 10000);

  it('a waitForReauthResult poll that was never racing logout still recovers normally (epoch unchanged ⇒ no regression)', async () => {
    const store = useAuthStore();
    store.token = 'x';
    vi.useFakeTimers(); // drive the poll interval deterministically
    let reads = 0;
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          if (msg?.action === 'logout') return cb({ status: 'ok' });
          reads += 1;
          if (reads === 1) return cb({ status: 'ok', active: true, phase: 'sso' });
          return cb({ status: 'ok', accessToken: 'jwt-fine' });
        },
      },
    };
    const promise = store.waitForReauthResult();
    await vi.advanceTimersByTimeAsync(0); // phase sso
    await vi.advanceTimersByTimeAsync(3000); // ok+token -> recovered
    expect(await promise).toBe('recovered');
    expect(store.token).toBe('jwt-fine'); // normal recovery still mints
    vi.useRealTimers();
  }, 10000);
});

describe('epoch ownership: late handoff/login after logout fully (RED)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete (globalThis as any).chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
    extMockState.logoutImpl = undefined;
    delete (globalThis as any).chrome;
    vi.useRealTimers();
  });

  it('late extension ok resolving AFTER logout fully never mints (flag down, epoch bumped)', async () => {
    let releaseHandoff!: () => void;
    const handoffGate = new Promise<any>((resolve) => {
      releaseHandoff = () => resolve({ status: 'ok', accessToken: 'jwt-raced-after-logout' });
    });
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') {
            handoffGate.then(cb); // extension answers ok only when released
          } else {
            cb({ status: 'ok' }); // logout wipe + anything else resolve
          }
        },
      },
    };
    const store = useAuthStore();
    store.token = 'x';
    localStorage.setItem('sso_token', 'x');
    const reauthPromise = store.attemptReauth(); // captures epoch, awaits handoff
    await flushPromises();
    await store.logout(); // FULLY completes while the handoff is still pending
    expect(store.token).toBeNull();
    expect(isLogoutInProgress()).toBe(false); // flag DOWN — boolean gate alone would mint
    releaseHandoff(); // late extension ok arrives after logout fully resolved
    expect(await reauthPromise).toBe('failed');
    expect(store.token).toBeNull(); // never resurrected
    expect(localStorage.getItem('sso_token')).toBeNull();
  });

  it('legacy login capture resolving AFTER logout fully never mints', async () => {
    let releaseCapture!: (v: unknown) => void;
    const captureGate = new Promise((resolve) => {
      releaseCapture = resolve;
    });
    (api.capture as any).mockImplementation(() => captureGate);
    const store = useAuthStore();
    store.token = 'x';
    localStorage.setItem('sso_token', 'x');
    const loginPromise = store.login();
    await flushPromises();
    await store.logout(); // fully completes while capture is in flight
    expect(store.token).toBeNull();
    expect(isLogoutInProgress()).toBe(false);
    releaseCapture({
      accessToken: 'jwt-legacy-raced', capturedAt: 0, hasSso: true, hasMicrosoft: false, hasKulon: true,
    });
    await loginPromise;
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
    (api.capture as any).mockReset();
  });

  it('finishHandoff/setToken with a stale epoch never write (generation-aware guarded commit)', async () => {
    const store = useAuthStore();
    store.token = 'x';
    localStorage.setItem('sso_token', 'x');
    const staleEpoch = getReauthEpoch();
    beginLogout();
    endLogout(); // bump epoch, flag down
    expect(isLogoutInProgress()).toBe(false);
    expect(getReauthEpoch()).toBe(staleEpoch + 1);
    (store as any).finishHandoff('jwt-stale', staleEpoch);
    expect(store.token).toBe('x');
    expect(localStorage.getItem('sso_token')).toBe('x');
    (store as any).setToken('jwt-stale-2', staleEpoch);
    expect(store.token).toBe('x');
    expect(localStorage.getItem('sso_token')).toBe('x');
  });
});

describe('old poll ownership: stale settle preserves newer attempt state (RED)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete (globalThis as any).chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
    delete (globalThis as any).chrome;
    vi.useRealTimers();
  });

  it('stale poll settle resolves failed but never clears a newer attempt reauthing/phase', async () => {
    vi.useFakeTimers();
    const store = useAuthStore();
    store.token = 'x';
    let reads = 0;
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          if (msg?.action === 'logout') return cb({ status: 'ok' });
          reads += 1;
          if (reads === 1) return cb({ status: 'ok', active: true, phase: 'sso' });
          return cb({ status: 'ok', accessToken: 'jwt-stale-poll' });
        },
      },
    };
    const epochBefore = getReauthEpoch();
    const oldPoll = store.waitForReauthResult(); // epoch E0
    await vi.advanceTimersByTimeAsync(0); // first read: in-progress sso
    await flushPromises();
    expect(reads).toBe(1);
    // Logout fully, then a NEWER attempt takes ownership of the overlay state:
    beginLogout();
    endLogout();
    expect(getReauthEpoch()).toBe(epochBefore + 1);
    store.reauthing = true; // new flow owns the overlay now
    store.reauthPhase = 'kulon';
    // Old poll's next tick fires stale:
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(await oldPoll).toBe('failed');
    expect(store.token).toBe('x'); // never minted the stale token
    expect(localStorage.getItem('sso_token')).toBeNull(); // waitForReauthResult never writes localStorage directly; token untouched
    expect(store.reauthing).toBe(true); // newer owner preserved
    expect(store.reauthPhase).toBe('kulon');
  }, 10000);
});

describe('bounded extension wipe: logout always releases (RED)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
    extMockState.logoutImpl = undefined;
    vi.useRealTimers();
  });

  it('logout resolves when the extension wipe hangs (bounded, flag released, token cleared)', async () => {
    vi.useFakeTimers();
    (api.logoutSession as any).mockResolvedValue(undefined);
    extMockState.logoutImpl = () => new Promise<void>(() => {}); // never settles
    const store = useAuthStore();
    store.token = 'x';
    localStorage.setItem('sso_token', 'x');
    const p = store.logout();
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(6000); // past the wipe bound
    await flushPromises();
    expect(settled).toBe(true); // RED with unbounded wipe: still pending
    await p;
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
    expect(isLogoutInProgress()).toBe(false);
  }, 10000);

  it('fast server revoke + fast wipe clear their timeout timers (no leaked 5s bound)', async () => {
    vi.useFakeTimers();
    // Direct proof of "clear the losing timer": both bounds (server revoke +
    // extension wipe) win the race here, so both timeout timers must be
    // cancelled. (An absolute getTimerCount()===0 assertion is brittle: Vue
    // reactivity schedules its own 0ms macrotasks during logout that outlive
    // the operation and are unrelated to our bounds.)
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    (api.logoutSession as any).mockResolvedValue(undefined);
    extMockState.logoutImpl = async () => {}; // fast wipe
    const store = useAuthStore();
    store.token = 'x';
    localStorage.setItem('sso_token', 'x');
    await store.logout();
    expect(isLogoutInProgress()).toBe(false);
    expect(clearSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // RED with raw Promise.race: 0 clears
    clearSpy.mockRestore();
  }, 10000);
});

describe('poll serialization: no overlapping reads or out-of-order application (RED)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete (globalThis as any).chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
    delete (globalThis as any).chrome;
    vi.useRealTimers();
  });

  it('never starts a second read while one is still pending (in-flight gate)', async () => {
    vi.useFakeTimers();
    const store = useAuthStore();
    store.token = 'x';
    let reads = 0;
    let releaseFirst!: (v: any) => void;
    const firstGate = new Promise<any>((resolve) => { releaseFirst = resolve; });
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          if (msg?.action === 'logout') return cb({ status: 'ok' });
          reads += 1;
          if (reads === 1) {
            // First read hangs: the poll must NOT start a second read on the
            // next tick while this one is pending.
            firstGate.then(cb);
            return;
          }
          return cb({ status: 'ok', active: true, phase: 'sso' });
        },
      },
    };
    const pollPromise = store.waitForReauthResult();
    await vi.advanceTimersByTimeAsync(0); // immediate attempt starts read #1 (pending)
    await flushPromises();
    expect(reads).toBe(1);
    // Next interval tick fires while read #1 is still pending:
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(reads).toBe(1); // serialized: no overlapping second read
    // Release the first read (in-progress) then let the poll continue normally:
    releaseFirst({ status: 'ok', active: true, phase: 'sso' });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(reads).toBe(2); // next read starts only AFTER the first settled
    // Settle the poll so the test does not leak a pending timer: logout bumps
    // the epoch and the NEXT tick self-cancels (advance to fire it).
    beginLogout();
    endLogout();
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(await pollPromise).toBe('failed');
    vi.useRealTimers();
  }, 10000);

  it('late out-of-order read after settle never mutates phase/token/overlay', async () => {
    vi.useFakeTimers();
    const store = useAuthStore();
    store.token = 'x';
    let reads = 0;
    let releaseSlow!: (v: any) => void;
    const slowGate = new Promise<any>((resolve) => { releaseSlow = resolve; });
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, msg: any, cb: (resp: any) => void) => {
          if (msg?.action === 'handoff') return cb({ status: 'started', mode: 'auto' });
          if (msg?.action === 'logout') return cb({ status: 'ok' });
          reads += 1;
          if (reads === 1) {
            slowGate.then(cb); // slow first read
            return;
          }
          return cb({ status: 'error', message: 'boom' }); // fast second settles failed
        },
      },
    };
    const pollPromise = store.waitForReauthResult();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(reads).toBe(1);
    // With serialization the second tick must wait; force-settle via logout so
    // the slow read becomes stale, then release it late:
    beginLogout();
    endLogout();
    releaseSlow({ status: 'ok', accessToken: 'jwt-late-slow', phase: 'siap' });
    await flushPromises();
    expect(await pollPromise).toBe('failed');
    expect(store.token).toBe('x'); // late slow ok never minted
    expect(store.reauthPhase).toBeNull(); // settle cleared (owner), late read did not re-set to siap
    vi.useRealTimers();
  }, 10000);
});
