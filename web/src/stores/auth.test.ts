import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';
import * as api from '../api/client';

vi.mock('../api/client', () => ({
  capture: vi.fn(),
  me: vi.fn(),
}));

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

  it('isHandoffMode reflects VITE_LOGIN_MODE', () => {
    vi.stubEnv('VITE_LOGIN_MODE', 'handoff');
    const store = useAuthStore();
    expect(store.isHandoffMode).toBe(true);
    vi.unstubAllEnvs();
  });
});