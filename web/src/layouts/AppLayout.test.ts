import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import AppLayout from './AppLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { resetUpstreamRecoveryState, upstreamRecoveryState } from '../lib/upstream-renewal';

vi.mock('../config/extension', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/extension')>()),
  EXTENSION_ID: 'test-extension-id',
}));

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/theme', () => ({ useThemeStore: vi.fn() }));
vi.mock('../api/client', () => ({
  getNotifications: vi.fn().mockResolvedValue({ count: 0, items: [] }),
  markNotificationRead: vi.fn(),
  getSiapProfile: vi.fn().mockResolvedValue({ nama: 'Test', nim: 'M12345' }),
  getSiapKhs: vi.fn().mockResolvedValue({ ipk: 0, semesters: [] }),
  getSiapIrs: vi.fn().mockResolvedValue({ semester: '', totalSks: 0, mataKuliah: [] }),
  getSiapJadwal: vi.fn().mockResolvedValue([]),
  getCourses: vi.fn().mockResolvedValue([]),
  getDashboardCourses: vi.fn().mockResolvedValue([]),
  getAllAssignments: vi.fn().mockResolvedValue([]),
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
    resetUpstreamRecoveryState();
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

  it('offers service login and keeps the existing session while the extension renews it', async () => {
    const fetchMe = vi.fn().mockResolvedValue('ok');
    mockStores({ token: 'jwt-a', fetchMe, sessionVersion: 0 });
    localStorage.setItem('sso_token', 'jwt-a');
    const sendMessage = vi.fn((_id, _msg, callback) => callback({ status: 'recovered' }));
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: null } });
    upstreamRecoveryState.siap = true;
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    const w = mount(AppLayout, { global: { plugins: [router] } });
    expect(w.find('[data-test="upstream-login-siap"]').text()).toContain('SIAP');
    await w.find('[data-test="upstream-login-siap"] button').trigger('click');
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledWith('test-extension-id',
      { action: 'renew', service: 'siap', token: 'jwt-a', interactive: true }, expect.any(Function));
    expect(localStorage.getItem('sso_token')).toBe('jwt-a');
    expect(w.find('[data-test="upstream-login-siap"]').exists()).toBe(false);
    expect(fetchMe).toHaveBeenCalled();
    w.unmount();
    vi.unstubAllGlobals();
    localStorage.clear();
  });
});
