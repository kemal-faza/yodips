import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AppHeader from './AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/theme', () => ({ useThemeStore: vi.fn() }));

function mockStores(auth: Record<string, unknown> = { isAuthenticated: true, logout: vi.fn(), user: null }, theme: Record<string, unknown> = { dark: false, toggle: vi.fn() }) {
  (useAuthStore as any).mockReturnValue(auth);
  (useThemeStore as any).mockReturnValue(theme);
}

describe('AppHeader', () => {
  it('emits back when the back button is clicked', async () => {
    mockStores();
    const w = mount(AppHeader, { props: { showBack: true } });
    await w.findAll('button').find((b) => b.text().includes('Kembali'))!.trigger('click');
    expect(w.emitted('back')).toHaveLength(1);
  });

  it('hides back button by default and shows breadcrumb', () => {
    mockStores();
    const w = mount(AppHeader, { props: { breadcrumb: 'SIAP' } });
    expect(w.text()).toContain('SIAP');
    expect(w.text()).not.toContain('Kembali');
  });

  it('calls store.logout when Keluar is clicked', async () => {
    const auth = { isAuthenticated: true, logout: vi.fn(), user: null };
    mockStores(auth);
    const w = mount(AppHeader);
    await w.findAll('button').find((b) => b.text().includes('Keluar'))!.trigger('click');
    expect(auth.logout).toHaveBeenCalled();
  });

  it('toggles the theme when the theme button is clicked', async () => {
    const theme = { dark: true, toggle: vi.fn() };
    mockStores({ isAuthenticated: true, logout: vi.fn(), user: null }, theme);
    const w = mount(AppHeader);
    await w.find('[data-test="theme-toggle"]').trigger('click');
    expect(theme.toggle).toHaveBeenCalled();
  });
});
