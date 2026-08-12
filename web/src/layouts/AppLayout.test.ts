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
vi.mock('../api/client', () => ({
  getNotifications: vi.fn().mockResolvedValue({ count: 0, items: [] }),
  markNotificationRead: vi.fn(),
}));

function mockStores(overrides: Record<string, unknown> = {}) {
  (useAuthStore as any).mockReturnValue({
    isAuthenticated: true,
    fetchMe: vi.fn().mockResolvedValue('ok'),
    logout: vi.fn(),
    user: { sub: 'M12345' },
    fotoUrl: null,
    ...overrides,
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

  it('shows the SIAP photo in the header avatar when store has a fotoUrl', async () => {
    mockStores({ fotoUrl: 'https://disk.undip.ac.id/ktm.jpg' });
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    const img = w.find('[data-test="user-avatar"] img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://disk.undip.ac.id/ktm.jpg');
  });

  it('shows the fallback initial when there is no fotoUrl', async () => {
    mockStores({ fotoUrl: null });
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find('[data-test="user-avatar"] img').exists()).toBe(false);
    expect(w.find('[data-test="user-avatar"]').text()).toContain('M');
  });

  it('opens the notification popover from the header bell', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    await w.find('[data-test="notification-toggle"]').trigger('click');
    expect(w.text()).toContain('Notifikasi');
  });
});
