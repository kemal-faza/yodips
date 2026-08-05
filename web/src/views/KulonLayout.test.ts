import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonLayout from './KulonLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/theme', () => ({ useThemeStore: vi.fn() }));

function mockStores() {
  (useAuthStore as any).mockReturnValue({ isAuthenticated: true, fetchMe: vi.fn().mockResolvedValue('ok'), logout: vi.fn(), user: null });
  (useThemeStore as any).mockReturnValue({ dark: false, toggle: vi.fn() });
}

describe('KulonLayout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStores();
  });

  it('hides back button on the dashboard route', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    await flushPromises();
    const w = mount(KulonLayout, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.find('[aria-label="Kembali"]').exists()).toBe(false);
  });

  it('shows back button on course detail route', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/matakuliah/9');
    await flushPromises();
    const w = mount(KulonLayout, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.find('[aria-label="Kembali"]').exists()).toBe(true);
  });

  it('back button navigates to /kulon/matakuliah', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/matakuliah/9');
    await flushPromises();
    const w = mount(KulonLayout, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[aria-label="Kembali"]').trigger('click');
    // Lazy-loaded route (KulonCoursesView) butuh waktu resolve nyata setelah klik.
    await new Promise((r) => setTimeout(r, 200));
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/kulon/matakuliah');
  });
});