import { describe, expect, it } from 'vitest';
import {
  MONTH_NAMES_ID,
  WEEKDAY_SHORT,
  currentCalendarMonth,
  eventsByTanggal,
  formatWaktuEmDash,
  monthGrid,
  monthTitle,
  toDateIso,
  todaysSchedule,
} from './calendar';
import type { SiapJadwal } from '../types';

const row = (over: Partial<SiapJadwal>): SiapJadwal => ({
  hari: 'Senin',
  matakuliah: 'Matkul',
  waktu: '09:40:00 s/d 12:10:00',
  sks: 3,
  ...over,
});

describe('monthGrid (Sunday-first 42 sel, port ScheduleScreen.kt)', () => {
  it('Agustus 2026: 1 = Sabtu (lead 6), 31 hari', () => {
    const cells = monthGrid(2026, 8);
    expect(cells).toHaveLength(42);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe(1);
    expect(cells[36]).toBe(31);
    expect(cells.slice(37)).toEqual([null, null, null, null, null]);
  });
  it('Februari 2027: 1 = Senin (lead 1), 28 hari', () => {
    const cells = monthGrid(2027, 2);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe(1);
    expect(cells[28]).toBe(28);
    expect(cells[29]).toBeNull();
  });
});

describe('label & format', () => {
  it('monthTitle bahasa Indonesia; 12 bulan', () => {
    expect(monthTitle(2026, 8)).toBe('Agustus 2026');
    expect(MONTH_NAMES_ID).toHaveLength(12);
  });
  it('WEEKDAY_SHORT Sunday-first', () => {
    expect(WEEKDAY_SHORT[0]).toBe('Min');
    expect(WEEKDAY_SHORT[6]).toBe('Sab');
  });
  it('formatWaktuEmDash menormalkan s/d & detik', () => {
    expect(formatWaktuEmDash('09:40:00 s/d 12:10:00')).toBe('09:40 — 12:10');
    expect(formatWaktuEmDash('09:40-12:10')).toBe('09:40 — 12:10');
    expect(formatWaktuEmDash(undefined)).toBe('');
  });
  it('toDateIso lokal (bukan UTC)', () => {
    expect(toDateIso(new Date(2026, 7, 24))).toBe('2026-08-24');
  });
});

describe('eventsByTanggal & currentCalendarMonth', () => {
  it('group by tanggal, buang tanpa tanggal, urut naik', () => {
    const map = eventsByTanggal([
      row({ tanggal: '2026-08-20' }),
      row({ tanggal: '2026-08-04' }),
      row({}), // tanpa tanggal → dibuang
    ]);
    expect([...map.keys()]).toEqual(['2026-08-04', '2026-08-20']);
    expect(map.get('2026-08-04')).toHaveLength(1);
  });
  it('currentCalendarMonth = bulan event pertama, fallback sekarang', () => {
    expect(currentCalendarMonth(eventsByTanggal([row({ tanggal: '2026-03-10' })]))).toBe('2026-03');
    expect(currentCalendarMonth(new Map())).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('todaysSchedule', () => {
  it('feed ber-tanggal: match tanggal iso saja', () => {
    const now = new Date(2026, 7, 20); // Kamis
    const rows = [
      row({ matakuliah: 'A', tanggal: '2026-08-20' }),
      row({ matakuliah: 'B', tanggal: '2026-08-21' }),
      row({ matakuliah: 'C', hari: 'Kamis' }), // diabaikan saat feed ber-tanggal
    ];
    expect(todaysSchedule(rows, now).map((r) => r.matakuliah)).toEqual(['A']);
  });
  it('feed mingguan polos: fallback match nama hari', () => {
    const now = new Date(2026, 7, 20); // Kamis
    const rows = [
      row({ matakuliah: 'C', hari: 'Kamis' }),
      row({ matakuliah: 'D', hari: 'Jumat' }),
      row({ matakuliah: 'E', hari: 'kamis' }), // case-insensitive
    ];
    expect(todaysSchedule(rows, now).map((r) => r.matakuliah)).toEqual(['C', 'E']);
  });
});
