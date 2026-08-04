import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AcademicPanel from './AcademicPanel.vue';
import * as api from '../api/client';

vi.mock('../api/client', () => ({
  getSiapProfile: vi.fn(),
  getSiapIrs: vi.fn(),
  getSiapKhs: vi.fn(),
}));

describe('AcademicPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'Budi Santoso',
      nim: '2600000001',
      prodi: 'Teknik Informatika',
      fakultas: 'Fakultas Teknik',
      status: 'aktif',
      ipk: 3.5,
    });
    (api.getSiapIrs as any).mockResolvedValue({
      semester: '2025/2026 Genap',
      totalSks: 20,
      mataKuliah: [
        { kode: 'IF101', nama: 'Algoritma', sks: 3, status: 'disetujui' },
        { kode: 'IF102', nama: 'Basis Data', sks: 3, status: 'rencana' },
      ],
    });
    (api.getSiapKhs as any).mockResolvedValue({
      ipk: 3.5,
      semesters: [
        {
          semester: 'Semester 1',
          ip: 3.4,
          totalSks: 20,
          nilai: [
            { mataKuliah: 'Algoritma', sks: 3, nilaiHuruf: 'A' },
            { mataKuliah: 'Basis Data', sks: 3, nilaiHuruf: 'A-' },
          ],
        },
      ],
    });
  });

  it('renders the three sections with data when hasSiap is true', async () => {
    const w = mount(AcademicPanel, { props: { hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('Budi Santoso');
    expect(w.text()).toContain('Profil');
    expect(w.text()).toContain('IRS');
    expect(w.text()).toContain('KHS');
    expect(api.getSiapProfile).toHaveBeenCalled();
    expect(api.getSiapIrs).toHaveBeenCalled();
    expect(api.getSiapKhs).toHaveBeenCalled();
  });

  it('shows a prompt and does not fetch when hasSiap is false', async () => {
    const w = mount(AcademicPanel, { props: { hasSiap: false } });
    await w.vm.$nextTick();
    expect(w.text()).toContain('Belum ada session SIAP');
    expect(api.getSiapProfile).not.toHaveBeenCalled();
  });

  it('shows a friendly error message when fetching fails', async () => {
    (api.getSiapIrs as any).mockRejectedValue({
      response: { status: 401, data: { message: 'Session SIAP expired — silakan login ulang via SSO' } },
    });
    const w = mount(AcademicPanel, { props: { hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('Session SIAP expired');
  });

  it('auto-polls every 30s while visible', async () => {
    vi.useFakeTimers();
    try {
      const w = mount(AcademicPanel, { props: { hasSiap: true } });
      // Flush the initial onMounted load's microtasks without relying on a
      // real setTimeout (which is faked by useFakeTimers).
      await vi.advanceTimersByTimeAsync(0);
      (api.getSiapKhs as any).mockClear();
      vi.advanceTimersByTime(30000);
      expect(api.getSiapKhs).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-fetches via the Segarkan button when clicked', async () => {
    const w = mount(AcademicPanel, { props: { hasSiap: true } });
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    (api.getSiapProfile as any).mockClear();
    (api.getSiapIrs as any).mockClear();
    (api.getSiapKhs as any).mockClear();
    await w.find('button').trigger('click');
    await w.vm.$nextTick();
    expect(api.getSiapProfile).toHaveBeenCalled();
    expect(api.getSiapIrs).toHaveBeenCalled();
    expect(api.getSiapKhs).toHaveBeenCalled();
  });
});