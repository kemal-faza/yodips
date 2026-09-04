import { beforeEach, describe, expect, it, vi } from 'vitest';

// vitest 4 removed the flushPromises export; provide it locally so we can drain
// the microtask queue after advancing fake timers. Pure microtask (no timers) so
// it also works while vi.useFakeTimers() is active.
function flushPromises(): Promise<void> {
  return Promise.resolve();
}
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';
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
});
