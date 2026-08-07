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
    const store = { login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: null, isHandoffMode: false };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('Login via SSO');
  });

  it('calls store.login on button click', async () => {
    const store = { login: vi.fn().mockResolvedValue(undefined), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: null, isHandoffMode: false };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    await w.find('button').trigger('click');
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
  });

  it('shows error message when login fails', () => {
    const store = { login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: 'Gagal login', isHandoffMode: false };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('Gagal login');
  });

  it('shows interactive login hint while checking', () => {
    const store = { login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: true, error: null, isHandoffMode: false };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    expect(w.text()).toContain('selesaikan login di window browser');
  });

  it('handoff mode with ?token= calls finishHandoff and routes home', async () => {
    const store = { login: vi.fn(), finishHandoff: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: null, isHandoffMode: true };
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
    const store = { login: vi.fn(), finishHandoff: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: null, isHandoffMode: true };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('jalankan tool capture');
  });

  it('shows an incomplete-session notice when reason=incomplete', () => {
    const store = { login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'), isExtensionInstalled: vi.fn().mockResolvedValue(false), checking: false, error: null, isHandoffMode: false };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: { reason: 'incomplete' } }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('belum lengkap');
  });

  it('shows Login via Extension button when extension installed', async () => {
    const store = {
      login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'),
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      checking: false, error: null, isHandoffMode: false,
    };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).toContain('Login via Extension');
  });

  it('hides Login via Extension button when not installed', async () => {
    const store = {
      login: vi.fn(), loginViaExtension: vi.fn(),
      isExtensionInstalled: vi.fn().mockResolvedValue(false),
      checking: false, error: null, isHandoffMode: false,
    };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).not.toContain('Login via Extension');
  });

  it('calls loginViaExtension and routes home on ok', async () => {
    const store = {
      login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('ok'),
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      checking: false, error: null, isHandoffMode: false,
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = { push: vi.fn() };
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    const btns = w.findAll('button');
    const ext = btns.find((b) => b.text().includes('Login via Extension'))!;
    await ext.trigger('click');
    await flushPromises();
    expect(store.loginViaExtension).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('shows notice when extension returns need-login', async () => {
    const store = {
      login: vi.fn(), loginViaExtension: vi.fn().mockResolvedValue('need-login'),
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      checking: false, error: null, isHandoffMode: false,
    };
    (useAuthStore as any).mockReturnValue(store);
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w.findAll('button').find((b) => b.text().includes('Login via Extension'))!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Login dulu di tab');
  });
});