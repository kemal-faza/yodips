import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getSiapAbsen = vi.hoisted(() => vi.fn());
const getSiapKehadiran = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ getSiapAbsen, getSiapKehadiran }));

import PresensiMobile from './PresensiMobile.vue';

beforeEach(() => {
  getSiapAbsen.mockReset().mockResolvedValue([
    { idJadwal: '77', nama: 'Pemrograman Web', hadirPct: 85.7, hadir: 12, total: 14 },
    { idJadwal: '88', nama: 'Basis Data', hadirPct: 50, hadir: 7, total: 14 },
  ]);
  getSiapKehadiran.mockReset().mockResolvedValue({
    pertemuanId: '77',
    sections: [
      {
        label: 'Absensi Kuliah',
        rows: [
          { pertemuanKe: '1', tanggal: 'Senin, 17 Agustus 2026', waktu: '09:40 - 12:10', kelas: 'C', kehadiran: 'Hadir', waktuAbsen: '-', aktor: 'dosen' },
          { pertemuanKe: '2', tanggal: 'Senin, 24 Agustus 2026', waktu: '09:40 - 12:10', kelas: 'C', kehadiran: '', waktuAbsen: '-', aktor: '-' },
        ],
      },
    ],
  });
});

describe('PresensiMobile', () => {
  it('daftar matkul dengan ringkasan hadir/total', async () => {
    const w = mount(PresensiMobile);
    await flushPromises();
    const items = w.findAll('[data-test="presensi-item"]');
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain('Pemrograman Web');
    expect(items[0].text()).toContain('12/14');
  });

  it('tap matkul memuat detail via getSiapKehadiran(idJadwal) + tabel render', async () => {
    const w = mount(PresensiMobile);
    await flushPromises();
    await w.findAll('[data-test="presensi-item"]')[0].trigger('click');
    await flushPromises();
    expect(getSiapKehadiran).toHaveBeenCalledWith('77');
    expect(w.text()).toContain('Absensi Kuliah');
    expect(w.text()).toContain('17 Agustus 2026');
    const badges = w.findAll('[data-test="presence-badge"]');
    expect(badges).toHaveLength(2);
    expect(badges[0].classes().join(' ')).toContain('success');
    expect(badges[1].classes().join(' ')).not.toContain('success');
  });

  it('section ber-message menampilkan pesan tanpa tabel', async () => {
    getSiapKehadiran.mockResolvedValue({
      pertemuanId: '77',
      sections: [{ label: 'Absensi Ujian', rows: [], message: 'Belum ada data' }],
    });
    const w = mount(PresensiMobile);
    await flushPromises();
    await w.findAll('[data-test="presensi-item"]')[0].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Belum ada data');
  });

  it('error fetch detail menampilkan pesan dari respons', async () => {
    getSiapKehadiran.mockRejectedValue({ response: { status: 400, data: { message: 'ID kehadiran tidak valid' } } });
    const w = mount(PresensiMobile);
    await flushPromises();
    await w.findAll('[data-test="presensi-item"]')[0].trigger('click');
    await flushPromises();
    expect(w.find('[data-test="presensi-error"]').text()).toContain('ID kehadiran tidak valid');
  });
});
