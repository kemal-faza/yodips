import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getSiapProfile = vi.hoisted(() => vi.fn());
const getSiapIrs = vi.hoisted(() => vi.fn());
const getSiapJadwal = vi.hoisted(() => vi.fn());
const getSiapLecturers = vi.hoisted(() => vi.fn());
const getSiapAbsen = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({
  getSiapProfile, getSiapIrs, getSiapJadwal, getSiapLecturers, getSiapAbsen,
}));

import IrsMobile from './IrsMobile.vue';

beforeEach(() => {
  getSiapProfile.mockReset().mockResolvedValue({ angkatan: '2024', semesterBerjalan: '2026/2027 Ganjil' });
  getSiapIrs.mockReset().mockResolvedValue({
    semester: '2026/2027 Ganjil', totalSks: 21,
    mataKuliah: [{ kode: 'MK-X', nama: 'Pemrograman Web', sks: 3, status: 'disetujui' }],
  });
  getSiapJadwal.mockReset().mockResolvedValue([
    { hari: 'Senin', matakuliah: 'Pemrograman Web', waktu: '09:40:00 s/d 12:10:00', sks: 3, tanggal: '2026-08-24', kode: 'MIK9', ruang: 'Lab D' },
  ]);
  getSiapLecturers.mockReset().mockResolvedValue([{ kode: 'MIK9', dosen: 'Pak Budi' }]);
  getSiapAbsen.mockReset().mockResolvedValue([
    { idJadwal: '77', nama: 'Pemrograman Web', hadirPct: 85.7, hadir: 12, total: 14 },
  ]);
});

describe('IrsMobile', () => {
  it('kartu semester ordinal + ringkasan jumlah MK/SKS', async () => {
    const w = mount(IrsMobile);
    await flushPromises();
    expect(w.find('[data-test="irs-semester"]').text()).toContain('Semester 5');
    expect(w.find('[data-test="irs-summary"]').text()).toContain('1 mata kuliah');
    expect(w.find('[data-test="irs-summary"]').text()).toContain('Total SKS 21');
  });

  it('kartu MK join jadwal+dosen+kehadiran (setara kartu Android)', async () => {
    const w = mount(IrsMobile);
    await flushPromises();
    const card = w.find('[data-test="schedule-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('Pemrograman Web');
    expect(card.text()).toContain('MIK9');
    expect(card.text()).toContain('09:40 — 12:10');
    expect(card.text()).toContain('Pak Budi');
    expect(card.find('[data-test="kehadiran"]').text()).toContain('12/14');
  });

  it('error fetch menampilkan pesan generik', async () => {
    getSiapIrs.mockRejectedValue(new Error('down'));
    const w = mount(IrsMobile);
    await flushPromises();
    expect(w.text()).toContain('Gagal memuat IRS.');
  });
});
