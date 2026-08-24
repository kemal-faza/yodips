import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ScheduleCardMobile from './ScheduleCardMobile.vue';
import type { SiapAbsenItem } from '../../types';

const base = {
  kode: 'MIK16245xx',
  matakuliah: 'Pemrograman Web',
  ruang: 'Lab D',
  waktu: '09:40:00 s/d 12:10:00',
  hari: 'Senin',
  sks: 3,
};

const absen: SiapAbsenItem = { idJadwal: '77', nama: 'Pemrograman Web', hadirPct: 50, hadir: 12, total: 14 };

describe('ScheduleCardMobile', () => {
  it('render nama/kode/SKS/waktu-emdash/ruang/dosen', () => {
    const w = mount(ScheduleCardMobile, { props: { jadwal: base, lecturer: 'Pak Budi', absen } });
    expect(w.find('[data-test="schedule-card"]').exists()).toBe(true);
    expect(w.text()).toContain('Pemrograman Web');
    expect(w.text()).toContain('MIK16245xx');
    expect(w.text()).toContain('3 SKS');
    expect(w.text()).toContain('09:40 — 12:10');
    expect(w.text()).toContain('Lab D');
    expect(w.text()).toContain('Pak Budi');
  });

  it('kehadiran x/y + progress width dari hadir/total', () => {
    const w = mount(ScheduleCardMobile, { props: { jadwal: base, absen } });
    expect(w.find('[data-test="kehadiran"]').text()).toContain('12/14');
    const bar = w.find('[data-test="kehadiran-bar"]');
    expect(bar.attributes('style')).toContain('width: 86%'); // round(12/14*100)=86
  });

  it('fallback hadirPct bila total 0', () => {
    const w = mount(ScheduleCardMobile, {
      props: { jadwal: base, absen: { ...absen, hadir: 0, total: 0 } },
    });
    expect(w.find('[data-test="kehadiran-bar"]').attributes('style')).toContain('width: 50%');
  });

  it('tanpa absen/dosen/ruang: baris terkait disembunyikan', () => {
    const w = mount(ScheduleCardMobile, { props: { jadwal: { ...base, ruang: undefined } } });
    expect(w.find('[data-test="kehadiran"]').exists()).toBe(false);
    expect(w.text()).not.toContain('Dosen:');
    expect(w.text()).not.toContain('Ruang:');
  });
});
