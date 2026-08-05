import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonNav from './KulonNav.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('KulonNav', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: true,
      fetchMe: vi.fn().mockResolvedValue('ok'),
      logout: vi.fn(),
    });
  });

  it('renders two tabs', async () => {
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    await flushPromises();
    const w = mount(KulonNav, { global: { plugins: [router] } });
    expect(w.text()).toContain('Dashboard');
    expect(w.text()).toContain('Mata Kuliah');
  });
});