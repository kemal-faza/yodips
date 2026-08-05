import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SiapDashboard from './SiapDashboard.vue';
import * as api from '../api/client';

vi.mock('../api/client', () => ({
  getSiapIrs: vi.fn(),
  getSiapKhs: vi.fn(),
}));

const profile = {
  nama: 'ANONIM UJI',
  nim: '24060121130000',
  prodi: 'Informatika S1',
  fakultas: 'SAINS DAN MATEMATIKA',
  angkatan: '2024',
  status: 'AKTIF',
  semesterBerjalan: '2026/2027 Ganjil',
};

describe('SiapDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getSiapIrs as any).mockResolvedValue({
      semester: '2026/2027 Ganjil',
      totalSks: 23,
      mataKuliah: [{ kode: 'MIK1624503', nama: 'Sistem Informasi', sks: 5, status: 'B' }],
    });
    (api.getSiapKhs as any).mockResolvedValue({
      ipk: 3.95,
      semesters: [{ semester: 'Semester 1', ip: 3.4, totalSks: 20, nilai: [{ mataKuliah: 'Aljabar', sks: 3, nilaiHuruf: 'A' }] }],
    });
  });

  it('renders status, prestasi, IRS and KHS when hasSiap is true', async () => {
    const w = mount(SiapDashboard, { props: { profile, hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('Status Akademik');
    expect(w.text()).toContain('3.95'); // IPK (khs)
    expect(w.text()).toContain('23');   // total SKS (irs)
    expect(w.text()).toContain('Sistem Informasi');
    expect(w.text()).toContain('Quick Link');
    expect(api.getSiapIrs).toHaveBeenCalled();
    expect(api.getSiapKhs).toHaveBeenCalled();
  });

  it('shows a prompt and does not fetch when hasSiap is false', async () => {
    const w = mount(SiapDashboard, { props: { profile: null, hasSiap: false } });
    await w.vm.$nextTick();
    expect(w.text()).toContain('Belum ada session SIAP');
    expect(api.getSiapIrs).not.toHaveBeenCalled();
  });

  it('shows a friendly error message when fetching fails', async () => {
    (api.getSiapKhs as any).mockRejectedValue({
      response: { status: 401, data: { message: 'Session SIAP expired — silakan login ulang via SSO' } },
    });
    const w = mount(SiapDashboard, { props: { profile, hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('Session SIAP expired');
  });

  it('re-fetches via the Segarkan button', async () => {
    const w = mount(SiapDashboard, { props: { profile, hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    (api.getSiapIrs as any).mockClear();
    (api.getSiapKhs as any).mockClear();
    await w.find('button').trigger('click'); // Segarkan
    await w.vm.$nextTick();
    expect(api.getSiapIrs).toHaveBeenCalled();
    expect(api.getSiapKhs).toHaveBeenCalled();
  });
});
