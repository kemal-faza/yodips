import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import AppLayout from './AppLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/theme', () => ({ useThemeStore: vi.fn() }));

function mockStores() {
  (useAuthStore as any).mockReturnValue({
    isAuthenticated: true,
    fetchMe: vi.fn().mockResolvedValue('ok'),
    logout: vi.fn(),
    user: { sub: 'M12345' },
  });
  (useThemeStore as any).mockReturnValue({ dark: false, toggle: vi.fn() });
}

describe('AppLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStores();
  });

  it('renders sidebar, sticky header, theme toggle and initial', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find('[data-test="app-sidebar"]').exists()).toBe(true);
    expect(w.find('[data-test="app-header"]').exists()).toBe(true);
    expect(w.find('[data-test="theme-toggle"]').exists()).toBe(true);
    expect(w.text()).toContain('M'); // Avatar initial from M12345
  });

  it('displays dynamic page title based on route', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find('h1').text()).toBe('Tugas Kulon');
  });

  it('toggles mobile menu state', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    const toggleBtn = w.find('[data-test="mobile-menu-toggle"]');
    await toggleBtn.trigger('click');
    expect(w.find('[data-test="sidebar-backdrop"]').exists()).toBe(true);
  });
});
