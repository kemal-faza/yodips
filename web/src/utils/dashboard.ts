import type { SiapKhs, SiapIrs, SiapJadwal, Assignment, SiapKhsSemester, Course } from '../types';
import { isDone, courseActive } from './assignment';

export interface TaskStats {
  /** Kulon "perlu dikerjakan": active-semester course, not submitted, not overdue. */
  need: number;
  /** Kulon "terlambat": overdue and not submitted. */
  late: number;
  /** Kulon "sudah dikerjakan": submitted or graded. */
  done: number;
}

export function taskStats(assignments: Assignment[], courses: Course[]): TaskStats {
  let need = 0;
  let late = 0;
  let done = 0;
  for (const a of assignments) {
    if (isDone(a)) {
      done++;
    } else if (a.overdue) {
      late++;
    } else if (courseActive(a, courses)) {
      need++;
    }
  }
  return { need, late, done };
}

export interface IpTrendRow {
  semester: string;
  ip: number;
}

export function ipTrend(khs: SiapKhs | null): IpTrendRow[] {
  return (khs?.semesters ?? [])
    .filter(gradedSemester)
    .map((s) => ({ semester: s.semester, ip: s.ip }));
}

export interface CumulativeSksRow {
  semester: string;
  sksKumulatif: number;
}

export function cumulativeSks(khs: SiapKhs | null): CumulativeSksRow[] {
  let running = 0;
  return (khs?.semesters ?? [])
    .filter(sksSemester)
    .map((s) => {
      running += s.totalSks;
      return { semester: s.semester, sksKumulatif: running };
    });
}

const GRADE_KEYS = ['A', 'AB', 'B', 'BC', 'C', 'D', 'E'] as const;
export type GradeKey = (typeof GRADE_KEYS)[number];

export interface GradeDistRow {
  semester: string;
  A: number;
  AB: number;
  B: number;
  BC: number;
  C: number;
  D: number;
  E: number;
}

export function gradeDistribution(khs: SiapKhs | null): GradeDistRow[] {
  return (khs?.semesters ?? [])
    .filter(gradedSemester)
    .map((s) => {
      const row: GradeDistRow = { semester: s.semester, A: 0, AB: 0, B: 0, BC: 0, C: 0, D: 0, E: 0 };
      for (const n of s.nilai) {
        const k = (n.nilaiHuruf ?? '').toUpperCase() as GradeKey;
        if (k in row) row[k] += 1;
      }
      return row;
    });
}

/** A semester is "graded" when it carries at least one real letter grade.
 * The getKhs fix makes the CURRENT term return enrolled courses with SKS but
 * empty nilaiHuruf / bobot 0 / ip 0 — `totalSks > 0` would let it leak into
 * IP/grade charts and crash the line to 0. */
function gradedSemester(s: SiapKhsSemester): boolean {
  return s.nilai.some((n) => (n.nilaiHuruf ?? '').trim() !== '');
}

/** SKS cumulative keeps its own totalSks-based filter (unchanged behavior):
 * the current term's taken SKS still counts toward the running total. */
function sksSemester(s: { totalSks: number }): boolean {
  return s.totalSks > 0;
}

export interface ScheduleItem {
  id: string;
  code: string;
  courseName: string;
  day?: string;
  timeStart?: string;
  timeEnd?: string;
  room?: string;
  sks: number;
  status: string;
  jadwalRaw?: string;
}

const DAY_RE = /(senin|selasa|rabu|kamis|jumat|sabtu)/i;
const TIME_RE = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/;

export function parseSchedule(irs: SiapIrs | null): ScheduleItem[] {
  return (irs?.mataKuliah ?? []).map((mk, i) => {
    const raw = mk.jadwal ?? '';
    const dayM = raw.match(DAY_RE);
    const timeM = raw.match(TIME_RE);
    const day = dayM ? dayM[1][0].toUpperCase() + dayM[1].slice(1) : undefined;
    return {
      id: `mk-${i}`,
      code: mk.kode,
      courseName: mk.nama,
      day,
      timeStart: timeM?.[1],
      timeEnd: timeM?.[2],
      room: mk.ruang,
      sks: mk.sks,
      status: mk.status,
      jadwalRaw: raw || undefined,
    };
  });
}

const JADWAL_TIME_RE = /(\d{1,2}:\d{2})(?::\d{2})?\s*(?:s\/d|[-–—])\s*(\d{1,2}:\d{2})(?::\d{2})?/;

/** Convert the SIAP "jadwal kuliah" rows into schedule items for the dashboard.
 * The jadwal view carries `hari`/`waktu`/`ruang` per course (unlike the IRS
 * endpoint, which lacks them). */
export function parseJadwal(rows: SiapJadwal[]): ScheduleItem[] {
  return (rows ?? []).map((r, i) => {
    const hari = (r.hari ?? '').trim();
    const day = hari ? hari[0].toUpperCase() + hari.slice(1).toLowerCase() : undefined;
    const m = JADWAL_TIME_RE.exec(r.waktu ?? '');
    return {
      id: `jadwal-${i}`,
      code: r.kode ?? '',
      courseName: r.matakuliah ?? '',
      day,
      timeStart: m?.[1],
      timeEnd: m?.[2],
      room: r.ruang,
      sks: r.sks,
      status: 'disetujui',
      jadwalRaw: r.waktu,
    };
  });
}