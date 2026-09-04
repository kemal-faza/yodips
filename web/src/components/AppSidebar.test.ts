import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import AppSidebar from './AppSidebar.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('AppSidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: true,
      fetchMe: vi.fn().mockResolvedValue('ok'),
      logout: vi.fn(),
    });
  });

  it('renders all navigation links', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppSidebar, { global: { plugins: [router] } });
    expect(w.text()).toContain('Dashboard');
    expect(w.text()).toContain('Tugas');
    expect(w.text()).toContain('Mata Kuliah');
  });

  it('navigates when a nav item is clicked', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await router.isReady();
    const pushSpy = vi.spyOn(router, 'push');
    const w = mount(AppSidebar, { global: { plugins: [router] } });
    const tugasBtn = w.find('[data-path="/kulon/dashboard"]');
    await tugasBtn.trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/kulon/dashboard');
  });

  it('calls logout when Keluar button is clicked', async () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined);
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: true,
      logout: logoutMock,
      fetchMe: vi.fn().mockResolvedValue('ok'), // afterEach memanggil fetchMe saat navigasi
    });
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppSidebar, { global: { plugins: [router] } });
    const logoutBtn = w.find('[data-test="sidebar-logout"]');
    await logoutBtn.trigger('click');
    await flushPromises();
    // The async handler awaits the (promise-returning) store logout before it
    // navigates — the mock store logout must have been called (and settled).
    expect(logoutMock).toHaveBeenCalled();
  });
});
