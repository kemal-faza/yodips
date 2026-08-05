import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AppHeader from './AppHeader.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('AppHeader', () => {
  it('emits back when the back button is clicked', async () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(AppHeader, { props: { showBack: true } });
    await w.findAll('button').find((b) => b.text().includes('Kembali'))!.trigger('click');
    expect(w.emitted('back')).toHaveLength(1);
  });

  it('hides back button by default and shows breadcrumb', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(AppHeader, { props: { breadcrumb: 'SIAP' } });
    expect(w.text()).toContain('SIAP');
    expect(w.text()).not.toContain('Kembali');
  });

  it('calls store.logout when Keluar is clicked', async () => {
    const store = { isAuthenticated: true, logout: vi.fn(), user: null };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(AppHeader);
    await w.findAll('button').find((b) => b.text().includes('Keluar'))!.trigger('click');
    expect(store.logout).toHaveBeenCalled();
  });
});