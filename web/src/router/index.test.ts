import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { buildRouter } from './index';

// vitest 4 does not export a `flushPromises` import; use a local helper.
const flushPromises = async () => {
  await new Promise((r) => setTimeout(r, 0));
};

vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(),
}));

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('redirects unauthenticated user to /login', async () => {
    const store = { isAuthenticated: false, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('proceeds immediately (non-blocking) and reauths on incomplete', async () => {
    const store = {
      isAuthenticated: true,
      // mirror the real fetchMe: on 'incomplete' it wipes the token
      // (clearSessionState), which flips isAuthenticated false.
      fetchMe: vi.fn(async () => {
        store.isAuthenticated = false;
        return 'incomplete';
      }),
      attemptReauth: vi.fn().mockResolvedValue('recovered'),
      logout: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(store.attemptReauth).toHaveBeenCalled();
  });

  it('falls back to /login?reason=incomplete when reauth fails', async () => {
    const store = {
      isAuthenticated: true,
      fetchMe: vi.fn(async () => {
        store.isAuthenticated = false;
        return 'incomplete';
      }),
      attemptReauth: vi.fn().mockResolvedValue('failed'),
      logout: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.reason).toBe('incomplete');
  });

  it('allows authenticated user to dashboard', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('resolves the profile route', async () => {
    const store = {
      isAuthenticated: true,
      fetchMe: vi.fn().mockResolvedValue('ok'),
      attemptReauth: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('profile');
  });
});