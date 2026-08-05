import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, type Router } from 'vue-router';
import { buildRouter } from '../router';
import DashboardView from './DashboardView.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

function mockStore() {
  const store = {
    isAuthenticated: true,
    logout: vi.fn(),
    user: null,
    checking: false,
    login: vi.fn().mockResolvedValue(undefined),
    hasSiap: true,
    fetchMe: vi.fn().mockResolvedValue('ok'),
  };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

/** Wrap router.push so the test can await the navigation triggered by an
 * un-awaited component call (router.push from a click handler is not awaited). */
function watchPush(router: Router): { awaitPush: () => Promise<void> } {
  let pending: Promise<unknown> | null = null;
  const orig = router.push.bind(router);
  router.push = ((...args: unknown[]) => {
    pending = orig(...(args as Parameters<Router['push']>));
    return pending;
  }) as Router['push'];
  return {
    awaitPush: async () => {
      if (pending) await pending;
      await flushPromises();
    },
  };
}

describe('DashboardView (hub)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStore();
  });

  it('shows the SSO dashboard hub by default', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain('Selamat datang di Undip SSO');
    expect(w.text()).toContain('Layanan');
  });

  it('navigates to /siap when the SIAP card is clicked', async () => {
    const router = buildRouter(createMemoryHistory());
    const { awaitPush } = watchPush(router);
    const w = mount(DashboardView, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-test="service-siap"]').trigger('click');
    await awaitPush();
    expect(router.currentRoute.value.path).toBe('/siap');
    expect(router.currentRoute.value.name).toBe('siap');
  });

  it('navigates to /kulon when the Kulon card is clicked', async () => {
    const router = buildRouter(createMemoryHistory());
    const { awaitPush } = watchPush(router);
    const w = mount(DashboardView, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await awaitPush();
    expect(router.currentRoute.value.path).toBe('/kulon/dashboard');
    expect(router.currentRoute.value.name).toBe('kulon-dashboard');
  });
});