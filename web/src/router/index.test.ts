import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { buildRouter } from './index';

vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(),
}));

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('redirects unauthenticated user to /login', async () => {
    const store = { isAuthenticated: false, fetchMe: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('bounces to /login?reason=incomplete when the server session is incomplete', async () => {
    const store = {
      isAuthenticated: true,
      // mirror the real fetchMe: on 'incomplete' it wipes the token (logout),
      // which flips isAuthenticated false so the login-bounce guard lets /login through.
      fetchMe: vi.fn(async () => {
        store.isAuthenticated = false;
        return 'incomplete';
      }),
      logout: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(store.fetchMe).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.reason).toBe('incomplete');
  });

  it('allows dashboard when fetchMe returns ok', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn().mockResolvedValue('ok') };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('does not bounce on network error (fetchMe error)', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn().mockResolvedValue('error') };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('allows authenticated user to dashboard', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('resolves the profile route', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn().mockResolvedValue('ok') };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('profile');
  });
});