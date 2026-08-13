import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ReauthOverlay from './ReauthOverlay.vue';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  capture: vi.fn(),
  me: vi.fn(),
  getSiapProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('../config/extension', () => ({ EXTENSION_ID: 'test-extension-id' }));

describe('ReauthOverlay', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('does not render when not reauthing', () => {
    const store = useAuthStore();
    store.reauthing = false;
    const w = mount(ReauthOverlay, { global: { plugins: [pinia] } });
    expect(w.text()).not.toContain('SSO');
  });

  it('renders SSO/Kulon/SIAP steps when reauthing', () => {
    useAuthStore().reauthing = true;
    const w = mount(ReauthOverlay, { global: { plugins: [pinia] } });
    expect(w.text()).toContain('SSO');
    expect(w.text()).toContain('Kulon');
    expect(w.text()).toContain('SIAP');
    expect(w.text()).toContain('Memulihkan sesi');
  });

  it('maps reauthPhase to the current step index', () => {
    const store = useAuthStore();
    store.reauthing = true;
    store.reauthPhase = 'kulon'; // index 1
    const w = mount(ReauthOverlay, { global: { plugins: [pinia] } });
    expect(w.text()).toContain('Kulon');
    expect(w.text()).toContain('SSO');
  });
});