import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AppHeader from './AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/theme', () => ({ useThemeStore: vi.fn() }));
vi.mock('../api/client', () => ({
  getNotifications: vi.fn().mockResolvedValue({ count: 0, items: [] }),
  markNotificationRead: vi.fn(),
}));
const mockPush = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => {
  mockPush.mockClear();
});

function mockStores(auth: Record<string, unknown> = { isAuthenticated: true, logout: vi.fn(), user: null }, theme: Record<string, unknown> = { dark: false, toggle: vi.fn() }) {
  (useAuthStore as any).mockReturnValue(auth);
  (useThemeStore as any).mockReturnValue(theme);
}

describe('AppHeader', () => {
  it('emits back when the back button is clicked', async () => {
    mockStores();
    const w = mount(AppHeader, { props: { showBack: true } });
    await w.find('[aria-label="Kembali"]').trigger('click');
    expect(w.emitted('back')).toHaveLength(1);
  });

  it('hides back button by default and shows breadcrumb', () => {
    mockStores();
    const w = mount(AppHeader, { props: { breadcrumb: 'SIAP' } });
    expect(w.text()).toContain('SIAP');
    expect(w.find('[aria-label="Kembali"]').exists()).toBe(false);
  });

  it('calls store.logout when Keluar is clicked', async () => {
    const auth = { isAuthenticated: true, logout: vi.fn().mockResolvedValue(undefined), user: null };
    mockStores(auth);
    const w = mount(AppHeader);
    await w.findAll('button').find((b) => b.text().includes('Keluar'))!.trigger('click');
    await flushPromises();
    expect(auth.logout).toHaveBeenCalled();
  });

  it('toggles the theme when the theme button is clicked', async () => {
    const theme = { dark: true, toggle: vi.fn() };
    mockStores({ isAuthenticated: true, logout: vi.fn(), user: null }, theme);
    const w = mount(AppHeader);
    await w.find('[data-test="theme-toggle"]').trigger('click');
    expect(theme.toggle).toHaveBeenCalled();
  });

  it('shows the SIAP photo when the store has a fotoUrl', () => {
    mockStores({ isAuthenticated: true, logout: vi.fn(), user: null, fotoUrl: 'https://disk.undip.ac.id/ktm.jpg' });
    const w = mount(AppHeader);
    expect(w.find('[data-test="avatar-siap"] img').attributes('src')).toBe('https://disk.undip.ac.id/ktm.jpg');
  });

  it('shows the fallback initial when there is no fotoUrl', () => {
    mockStores({ isAuthenticated: true, logout: vi.fn(), user: null, fotoUrl: null });
    const w = mount(AppHeader);
    expect(w.find('[data-test="avatar-siap"] img').exists()).toBe(false);
    expect(w.find('[data-test="avatar-siap"]').text()).toContain('U');
  });

  it('navigates to /profile when the avatar is clicked', async () => {
    mockStores({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(AppHeader);
    await w.find('[data-test="avatar-siap"]').trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });
});
