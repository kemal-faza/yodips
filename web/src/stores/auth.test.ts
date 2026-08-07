import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';
import * as api from '../api/client';
import { EXTENSION_ID } from '../config/extension';

vi.mock('../api/client', () => ({
  capture: vi.fn(),
  me: vi.fn(),
}));

// Test env has no VITE_EXTENSION_ID; give the store a stable non-empty ID so the
// sendToExtension guard passes and messages reach the stubbed chrome.runtime.
vi.mock('../config/extension', () => ({ EXTENSION_ID: 'test-extension-id' }));

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
    store.logout();
    expect(store.token).toBeNull();
    expect(localStorage.getItem('sso_token')).toBeNull();
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

  it('isHandoffMode reflects VITE_LOGIN_MODE', () => {
    vi.stubEnv('VITE_LOGIN_MODE', 'handoff');
    const store = useAuthStore();
    expect(store.isHandoffMode).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe('extension login', () => {
  function stubChrome(status: 'ok' | 'need-login' | 'error' | 'throw', accessToken?: string) {
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

  it('loginViaExtension returns need-login and clears stale error', async () => {
    stubChrome('need-login');
    const store = useAuthStore();
    store.error = 'old';
    expect(await store.loginViaExtension()).toBe('need-login');
    expect(store.error).toBeNull();
  });

  it('loginViaExtension returns error on handoff failure', async () => {
    stubChrome('error');
    const store = useAuthStore();
    expect(await store.loginViaExtension()).toBe('error');
    expect(store.token).toBeNull();
  });
});