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

  it('handoff mode with ?token= calls finishHandoff and routes home', async () => {
    const store = { login: vi.fn(), finishHandoff: vi.fn(), checking: false, error: null, isHandoffMode: true };
    (useAuthStore as any).mockReturnValue(store);
    const router = { push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: { $route: { query: { token: 'jwt-handoff' } }, $router: router },
      },
    });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledWith('jwt-handoff');
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('handoff mode without token shows capture instructions', () => {
    const store = { login: vi.fn(), finishHandoff: vi.fn(), checking: false, error: null, isHandoffMode: true };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('jalankan tool capture');
  });

  it('shows an incomplete-session notice when reason=incomplete', () => {
    const store = { login: vi.fn(), checking: false, error: null };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: { reason: 'incomplete' } }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('belum lengkap');
  });
});