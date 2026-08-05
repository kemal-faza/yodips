import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { buildRouter } from './router';
import { useAuthStore } from './stores/auth';
import * as api from './api/client';

vi.mock('./api/client', () => ({
  getAssignments: vi.fn().mockResolvedValue([]),
  getCourses: vi.fn().mockResolvedValue([]),
  capture: vi.fn(),
  me: vi.fn(),
  getSiapProfile: vi.fn().mockResolvedValue({ nama: 'X', nim: '1', status: 'aktif' }),
  getSiapIrs: vi.fn().mockResolvedValue({ semester: '', totalSks: 0, mataKuliah: [] }),
  getSiapKhs: vi.fn().mockResolvedValue({ ipk: 0, semesters: [] }),
}));

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('redirects to login when unauthenticated and shows login button', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('login');
    expect(w.text()).toContain('Login via SSO');
  });

  it('logs in and navigates to dashboard', async () => {
    (api.capture as any).mockResolvedValue({
      accessToken: 'tok', capturedAt: 0, hasSso: true, hasMicrosoft: true, hasKulon: true,
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push('/login');
    await flushPromises();

    // Drive the real login flow: call the store's login (same as the button does)
    const store = useAuthStore();
    await store.login();
    expect(store.isAuthenticated).toBe(true);

    // The login-view redirects to the dashboard after successful login.
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(w.text()).toContain('Selamat datang di Undip SSO');
  });
});