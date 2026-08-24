import type { SiapJadwal } from '../types';

/** Nama bulan Indonesia (header kalender + picker) — port MONTH_NAMES_ID Android. */
export const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const;

/** Header minggu kalender gaya KomoUI: Sunday-first. */
export const WEEKDAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;

const DAY_NAMES_ID = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

/**
 * Grid bulanan Sunday-first 42 sel (6 minggu); sel di luar bulan = null.
 * Port `monthGrid` ScheduleScreen.kt — lead = getDay(), Minggu=0.
 */
export function monthGrid(year: number, month: number): Array<number | null> {
  const lead = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells: Array<number | null> = Array.from({ length: 42 }, () => null);
  for (let d = 1; d <= days; d++) cells[lead + d - 1] = d;
  return cells;
}

/** `(2026, 8)` → "Agustus 2026". */
export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES_ID[month - 1]} ${year}`;
}

/** `yyyy-MM-dd` LOKAL (bukan toISOString UTC — hindari geser hari). */
export function toDateIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Group baris jadwal ber-per-tanggal (`tanggal` yyyy-MM-dd); baris tanpa
 * tanggal dibuang — kalender hanya menampilkan pertemuan ber-tanggal
 * (incl. reschedule). Key terurut naik.
 */
export function eventsByTanggal(rows: SiapJadwal[]): Map<string, SiapJadwal[]> {
  const out = new Map<string, SiapJadwal[]>();
  for (const r of rows ?? []) {
    if (!r.tanggal) continue;
    const arr = out.get(r.tanggal) ?? [];
    arr.push(r);
    out.set(r.tanggal, arr);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Bulan awal kalender: bulan event pertama, fallback bulan sekarang — "yyyy-MM". */
export function currentCalendarMonth(byTanggal: Map<string, SiapJadwal[]>): string {
  const first = [...byTanggal.keys()][0];
  const parsed = first ? new Date(`${first}T00:00:00`) : new Date();
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return toDateIso(base).slice(0, 7);
}

const WAKTU_RE = /(\d{1,2}:\d{2})(?::\d{2})?\s*(?:s\/d|[-–—])\s*(\d{1,2}:\d{2})(?::\d{2})?/;

/** "09:40:00 s/d 12:10:00" → "09:40 — 12:10" (emdash ala kartu Android). */
export function formatWaktuEmDash(raw?: string): string {
  const m = WAKTU_RE.exec(raw ?? '');
  if (m) return `${m[1]} — ${m[2]}`;
  return (raw ?? '').trim();
}

/**
 * Jadwal "hari ini": match `tanggal === iso(now)` bila feed ber-tanggal
 * (sumber kalender); feed mingguan polos fallback match nama hari.
 */
export function todaysSchedule(rows: SiapJadwal[], now: Date): SiapJadwal[] {
  const list = rows ?? [];
  if (list.some((r) => r.tanggal)) {
    const iso = toDateIso(now);
    return list.filter((r) => r.tanggal === iso);
  }
  const dayName = DAY_NAMES_ID[now.getDay()];
  return list.filter((r) => (r.hari ?? '').trim().toLowerCase() === dayName);
}
