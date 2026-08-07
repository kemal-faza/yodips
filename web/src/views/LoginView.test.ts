import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import LoginView from './LoginView.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

function makeStore(overrides: Record<string, any> = {}) {
  const store = {
    login: vi.fn().mockResolvedValue(undefined),
    loginViaExtension: vi.fn().mockResolvedValue('started'),
    isExtensionInstalled: vi.fn().mockResolvedValue(false),
    finishHandoff: vi.fn(),
    onExtensionResult: vi.fn().mockReturnValue(() => {}),
    checking: false,
    error: null,
    isHandoffMode: false,
    ...overrides,
  };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders login button', () => {
    makeStore();
    const w = mount(LoginView);
    expect(w.text()).toContain('Login via SSO');
  });

  it('calls store.login on button click', async () => {
    const store = makeStore();
    const w = mount(LoginView);
    await w.find('button').trigger('click');
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
  });

  it('shows error message when login fails', () => {
    makeStore({ error: 'Gagal login' });
    const w = mount(LoginView);
    expect(w.text()).toContain('Gagal login');
  });

  it('shows interactive login hint while checking', () => {
    makeStore({ checking: true });
    const w = mount(LoginView);
    expect(w.text()).toContain('selesaikan login di window browser');
  });

  it('handoff mode with ?token= calls finishHandoff and routes home', async () => {
    const store = makeStore({ isHandoffMode: true });
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
    makeStore({ isHandoffMode: true });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('jalankan tool capture');
  });

  it('shows an incomplete-session notice when reason=incomplete', () => {
    makeStore();
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: { reason: 'incomplete' } }, $router: { push: vi.fn() } } },
    });
    expect(w.text()).toContain('belum lengkap');
  });

  it('shows Login via Extension button and registers the result listener when installed', async () => {
    const store = makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(true) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).toContain('Login via Extension');
    expect(store.onExtensionResult).toHaveBeenCalled();
  });

  it('hides Login via Extension button when not installed', async () => {
    makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(false) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).not.toContain('Login via Extension');
  });

  it('calls loginViaExtension and routes home when it returns ok', async () => {
    const router = { push: vi.fn() };
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue('ok'),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    await w.findAll('button').find((b) => b.text().includes('Login via Extension'))!.trigger('click');
    await flushPromises();
    expect(store.loginViaExtension).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('shows waiting notice when loginViaExtension returns started', async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue('started'),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w.findAll('button').find((b) => b.text().includes('Login via Extension'))!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Menunggu login di tab');
  });

  it('finishes handoff when the extension posts an ok result to the window', async () => {
    const router = { push: vi.fn() };
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    // Capture the handler registered by onExtensionResult, then invoke it.
    const handler = (store.onExtensionResult as any).mock.calls[0][0];
    handler({ status: 'ok', accessToken: 'jwt-win' });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledWith('jwt-win');
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('shows the error message when the extension posts an error result', async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    const handler = (store.onExtensionResult as any).mock.calls[0][0];
    handler({ status: 'error', message: 'Login belum selesai' });
    await flushPromises();
    expect(w.text()).toContain('Login belum selesai');
  });
});
