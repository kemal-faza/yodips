import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import SiapView from './SiapView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  getSiapProfile: vi.fn(),
  getSiapIrs: vi.fn(),
  getSiapKhs: vi.fn(),
}));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

function mockStore() {
  const store = {
    isAuthenticated: true,
    hasSiap: true,
    logout: vi.fn(),
    login: vi.fn(),
    user: null,
    checking: false,
    fetchMe: vi.fn().mockResolvedValue('ok'),
  };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe('SiapView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStore();
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'ANONIM UJI',
      nim: '24060121130000',
      prodi: 'Informatika S1',
      fakultas: 'SAINS DAN MATEMATIKA',
      angkatan: '2024',
      status: 'AKTIF',
      semesterBerjalan: '2026/2027 Ganjil',
    });
  });

  it('shows profile after mount', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(SiapView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain('ANONIM UJI');
    expect(w.text()).toContain('24060121130000');
  });
});