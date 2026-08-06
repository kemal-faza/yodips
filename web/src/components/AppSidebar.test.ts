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

  it('renders all four navigation links', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppSidebar, { global: { plugins: [router] } });
    expect(w.text()).toContain('Beranda');
    expect(w.text()).toContain('Tugas');
    expect(w.text()).toContain('Mata Kuliah');
    expect(w.text()).toContain('Akademik');
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
    const logoutMock = vi.fn();
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: true,
      logout: logoutMock,
    });
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppSidebar, { global: { plugins: [router] } });
    const logoutBtn = w.find('[data-test="sidebar-logout"]');
    await logoutBtn.trigger('click');
    expect(logoutMock).toHaveBeenCalled();
  });
});
