import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ProfileView from './ProfileView.vue';
import * as api from '../api/client';

vi.mock('../api/client', () => ({
  getSiapProfile: vi.fn(),
  // PairingCard (dirender ProfileView) memakai dua fungsi ini:
  pairRequest: vi.fn(),
  pairConsume: vi.fn(),
}));

describe('ProfileView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the biodata groups from the profile', async () => {
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'Budi', nim: '240601', prodi: 'Informatika', fakultas: 'FSM',
      angkatan: '2024', nomorHp: '0812', emailSso: 'budi@undip.ac.id',
    });
    const w = mount(ProfileView);
    await flushPromises();
    expect(w.text()).toContain('Budi');
    expect(w.text()).toContain('240601');
    expect(w.text()).toContain('Informatika');
    expect(w.text()).toContain('0812');
  });

  it('shows a loading state then the profile', async () => {
    let resolve!: (v: any) => void;
    (api.getSiapProfile as any).mockReturnValue(new Promise((r) => { resolve = r; }));
    const w = mount(ProfileView);
    expect(w.text()).toContain('Memuat');
    resolve({ nama: 'Budi', nim: '1', status: 'aktif' });
    await flushPromises();
    expect(w.text()).toContain('Budi');
  });

  it('shows an error state on fetch failure', async () => {
    (api.getSiapProfile as any).mockRejectedValue(new Error('down'));
    const w = mount(ProfileView);
    await flushPromises();
    expect(w.text()).toContain('Gagal');
  });

  it('masks and reveals the Nama Ibu field', async () => {
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'Budi', nim: '1', status: 'aktif', namaIbu: 'SITI',
    });
    const w = mount(ProfileView);
    await flushPromises();
    expect(w.text()).toContain('********');
    await w.findAll('button').find((b) => b.text().includes('Tampilkan'))!.trigger('click');
    expect(w.text()).toContain('SITI');
    await w.findAll('button').find((b) => b.text().includes('Sembunyikan'))!.trigger('click');
    expect(w.text()).toContain('********');
  });
});