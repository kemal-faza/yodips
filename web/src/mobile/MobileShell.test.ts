import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';

// NotificationPopover mem-fetch notifikasi saat mount — stub API-nya.
vi.mock('../api/client', () => ({
  getNotifications: vi.fn(async () => ({ count: 0, items: [] })),
  markNotificationRead: vi.fn(async () => {}),
}));

import MobileShell from './MobileShell.vue';

function marker(name: string): NonNullable<RouteRecordRaw['component']> {
  return { template: `<p data-test="page">${name}</p>` };
}

function makeRouter(initial = '/') {
  const routes: RouteRecordRaw[] = [
    { path: '/', component: MobileShell, children: [
      // `name` WAJIB — judul & tombol back shell diturunkan dari route.name.
      { path: '', name: 'dashboard', component: marker('dash') },
      { path: 'kulon/dashboard', name: 'kulon-dashboard', component: marker('tugas') },
      { path: 'scan', name: 'scan', component: marker('scan') },
      { path: 'jadwal', name: 'jadwal', component: marker('jadwal') },
      { path: 'profile', name: 'profile', component: marker('profil') },
      { path: 'khs', name: 'khs', component: marker('khs') },
    ]},
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push(initial);
  return router;
}

function mountShell(router: ReturnType<typeof makeRouter>) {
  return mount(MobileShell, { global: { plugins: [router, createPinia()] } });
}

beforeEach(() => localStorage.clear());

describe('MobileShell', () => {
  it('judul Dashboard di "/" dan tab dashboard aria-current', async () => {
    const router = makeRouter('/');
    await router.isReady();
    const w = mountShell(router);
    await flushPromises();
    expect(w.find('[data-test="shell-title"]').text()).toBe('Dashboard');
    expect(w.find('[data-test="tab-dash"]').attributes('aria-current')).toBe('page');
    expect(w.find('[data-test="fab-scan"]').exists()).toBe(true);
  });

  it('navigasi ke /khs: judul KHS + tombol back tampil; tab tak aktif', async () => {
    const router = makeRouter('/khs');
    await router.isReady();
    const w = mountShell(router);
    await flushPromises();
    expect(w.find('[data-test="shell-title"]').text()).toBe('KHS');
    expect(w.find('[data-test="shell-back"]').exists()).toBe(true);
    expect(w.find('[data-test="tab-dash"]').attributes('aria-current')).toBeUndefined();
  });

  it('FAB mengarah ke /scan', async () => {
    const router = makeRouter('/');
    await router.isReady();
    const w = mountShell(router);
    await flushPromises();
    await w.find('[data-test="fab-scan"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/scan');
  });

  it('tab Tugas navigasi ke /kulon/dashboard', async () => {
    const router = makeRouter('/');
    await router.isReady();
    const w = mountShell(router);
    await flushPromises();
    await w.find('[data-test="tab-tasks"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/kulon/dashboard');
    expect(w.find('[data-test="shell-title"]').text()).toBe('Tugas');
  });
});
