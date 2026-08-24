import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getSiapJadwal = vi.hoisted(() => vi.fn());
const getSiapLecturers = vi.hoisted(() => vi.fn());
const getSiapAbsen = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ getSiapJadwal, getSiapLecturers, getSiapAbsen }));

import ScheduleMobile from './ScheduleMobile.vue';

beforeEach(() => {
  // toFake DIBATASI (bukan default semua-timer): flushPromises VTU memakai
  // setImmediate — kalau ikut di-fake, await flushPromises() deadlock.
  vi.useFakeTimers({ now: new Date(2026, 7, 24, 8, 0, 0), toFake: ['setTimeout', 'clearTimeout', 'Date'] }); // 2026-08-24 (Senin)
  getSiapJadwal.mockReset().mockResolvedValue([
    { hari: 'Senin', matakuliah: 'Pemrograman Web', waktu: '09:40:00 s/d 12:10:00', sks: 3, tanggal: '2026-08-24', kode: 'MIK1' },
    { hari: 'Selasa', matakuliah: 'Basis Data', waktu: '13:00 s/d 15:30', sks: 3, tanggal: '2026-08-25', kode: 'MIK2' },
  ]);
  getSiapLecturers.mockReset().mockResolvedValue([{ kode: 'MIK1', dosen: 'Pak Budi' }]);
  getSiapAbsen.mockReset().mockResolvedValue([
    { idJadwal: '77', nama: 'Pemrograman Web', hadirPct: 85, hadir: 12, total: 14 },
  ]);
});
afterEach(() => vi.useRealTimers());

describe('ScheduleMobile', () => {
  it('header bulan + weekday Sunday-first Min..Sab', async () => {
    const w = mount(ScheduleMobile, { global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.find('[data-test="cal-header"]').text()).toContain('Agustus 2026');
    const days = w.findAll('[data-test="weekday"]').map((n) => n.text());
    expect(days).toEqual(['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']);
  });

  it('dot pada tanggal ber-event; default selected hari ini → kartunya tampil lengkap', async () => {
    const w = mount(ScheduleMobile, { global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.find('[data-test="day-24"] [data-test="event-dot"]').exists()).toBe(true);
    expect(w.find('[data-test="day-25"] [data-test="event-dot"]').exists()).toBe(true);
    const cards = w.findAll('[data-test="schedule-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('Pemrograman Web');
    expect(cards[0].text()).toContain('09:40 — 12:10');
    expect(cards[0].text()).toContain('Pak Budi');
    expect(cards[0].find('[data-test="kehadiran"]').text()).toContain('12/14');
  });

  it('tap tanggal lain memuat kartu tanggal tsb', async () => {
    const w = mount(ScheduleMobile, { global: { stubs: { teleport: true } } });
    await flushPromises();
    await w.find('[data-test="day-25"]').trigger('click');
    const cards = w.findAll('[data-test="schedule-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('Basis Data');
  });

  it('picker: buka, nav tahun, pilih bulan', async () => {
    const w = mount(ScheduleMobile, { global: { stubs: { teleport: true } } });
    await flushPromises();
    await w.find('[data-test="cal-header"]').trigger('click');
    expect(w.find('[data-test="month-picker"]').exists()).toBe(true);
    await w.find('[data-test="year-prev"]').trigger('click');
    await w.findAll('[data-test="pick-month"]')[0].trigger('click'); // Januari
    expect(w.find('[data-test="cal-header"]').text()).toContain('Januari 2025');
    expect(w.find('[data-test="month-picker"]').exists()).toBe(false);
  });

  it('error fetch menampilkan pesan dari respons', async () => {
    getSiapJadwal.mockRejectedValue({ response: { data: { message: 'sesi SIAP berakhir' } } });
    const w = mount(ScheduleMobile, { global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(w.text()).toContain('sesi SIAP berakhir');
  });
});
