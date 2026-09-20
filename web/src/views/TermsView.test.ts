import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import TermsView from './TermsView.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

describe('TermsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the disclaimer and every required terms clause', () => {
    (useAuthStore as any).mockReturnValue({
      isAuthenticated: false,
      fetchMe: vi.fn(),
      attemptReauth: vi.fn(),
    });
    const wrapper = mount(TermsView, {
      global: { plugins: [buildRouter()] },
    });
    const text = wrapper.text();
    expect(text).toContain('Syarat Layanan YoDips');
    expect(text).toContain('tidak berafiliasi dengan');
    expect(text).toContain('Tanggung jawab kamu');
    expect(text).toContain('Data dan privasi');
    expect(text).toContain('Tersedia apa adanya');
    expect(text).toContain('Batasan tanggung jawab');
    expect(text).toContain('Penghentian layanan');
    expect(text).toContain('Perubahan syarat');
    expect(text).toContain('Hukum yang berlaku');
  });

  it('links to the privacy policy (they are not separable)', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: false });
    const wrapper = mount(TermsView, {
      global: { plugins: [buildRouter()] },
    });
    expect(wrapper.find('a[href="/privacy"]').exists()).toBe(true);
  });

  it('shows a back link to login when unauthenticated', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: false });
    const wrapper = mount(TermsView, {
      global: { plugins: [buildRouter()] },
    });
    const link = wrapper.find('a[href="/login"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Kembali ke Login');
  });

  it('shows a back link to the dashboard when authenticated', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true });
    const wrapper = mount(TermsView, {
      global: { plugins: [buildRouter()] },
    });
    expect(wrapper.find('a[href="/"]').exists()).toBe(true);
  });
});

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/terms', name: 'terms', component: TermsView }],
  });
}
