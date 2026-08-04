import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import LoginView from './LoginView.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders login button', () => {
    const store = { login: vi.fn(), checking: false, error: null };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('Login via SSO');
  });

  it('calls store.login on button click', async () => {
    const store = { login: vi.fn().mockResolvedValue(undefined), checking: false, error: null };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    await w.find('button').trigger('click');
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
  });

  it('shows error message when login fails', () => {
    const store = { login: vi.fn(), checking: false, error: 'Gagal login' };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('Gagal login');
  });

  it('shows interactive login hint while checking', () => {
    const store = { login: vi.fn(), checking: true, error: null };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('selesaikan login di window browser');
  });
});