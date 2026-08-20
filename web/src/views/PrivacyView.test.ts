import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import PrivacyView from './PrivacyView.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('PrivacyView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all six required privacy clauses', () => {
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: false,
      fetchMe: vi.fn(),
      attemptReauth: vi.fn(),
    });
    const wrapper = mount(PrivacyView, {
      global: { plugins: [buildRouter()] },
    });
    const text = wrapper.text();
    expect(text).toContain('Kebijakan Privasi YoDips');
    expect(text).toContain('Data yang dikumpulkan');
    expect(text).toContain('Cookie sesi Undip');
    expect(text).toContain('Identitas turunan (NIM)');
    expect(text).toContain('Tujuan penggunaan');
    expect(text).toContain('Kemana data dikirim');
    expect(text).toContain('backend YoDips');
    expect(text).toContain('tidak pernah melihat atau menyimpan kata sandi');
    expect(text).toContain('Kontak & hak Anda');
    expect(text).toContain('penghapusan data');
    expect(text).toContain('Only purposeful data');
  });

  it('shows a back link to login when unauthenticated', () => {
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: false,
    });
    const wrapper = mount(PrivacyView, {
      global: { plugins: [buildRouter()] },
    });
    const link = wrapper.find('a[href="/login"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Kembali ke Login');
  });

  it('shows a back link to the dashboard when authenticated', () => {
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: true,
    });
    const wrapper = mount(PrivacyView, {
      global: { plugins: [buildRouter()] },
    });
    expect(wrapper.find('a[href="/"]').exists()).toBe(true);
  });
});

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/privacy', name: 'privacy', component: PrivacyView }],
  });
}