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

  it('allows authenticated user to dashboard', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });
});