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

  it('renders every required privacy clause', () => {
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

  it('discloses the push third parties and the actual retention windows', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: false });
    const wrapper = mount(PrivacyView, {
      global: { plugins: [buildRouter()] },
    });
    const text = wrapper.text();
    // Push notifications do leave the backend; that must be stated, not implied away.
    expect(text).toContain('Berapa lama data disimpan');
    expect(text).toContain('Firebase');
    expect(text).toContain('7 hari');
    expect(text).toContain('30 menit');
    expect(text).toContain('14 hari');
  });

  it('uses a routable contact address (the deletion channel must actually work)', () => {
    (useAuthStore as any).mockReturnValue({ isAuthenticated: false });
    const wrapper = mount(PrivacyView, {
      global: { plugins: [buildRouter()] },
    });
    const mail = wrapper.find('a[href^="mailto:"]');
    expect(mail.exists()).toBe(true);
    expect(mail.attributes('href')).toBe('mailto:kemalfaza26@gmail.com');
    // A reserved test domain would silently black-hole deletion requests.
    expect(mail.attributes('href')).not.toContain('.test');
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