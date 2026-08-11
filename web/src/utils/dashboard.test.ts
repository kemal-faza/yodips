import { describe, expect, it } from 'vitest';
import {
  taskStats,
  ipTrend,
  cumulativeSks,
  gradeDistribution,
  parseSchedule,
} from './dashboard';
import type { SiapKhs, SiapIrs, Assignment } from '../types';

const NOW = 1000 * 1000; // 1000s past epoch — only relative deltas matter

const khs: SiapKhs = {
  ipk: 3.71,
  semesters: [
    { semester: 'Gasal 22/23', ip: 3.52, totalSks: 20, nilai: [
      { mataKuliah: 'Aljabar', sks: 3, nilaiHuruf: 'A', bobot: 4 },
      { mataKuliah: 'Logika', sks: 3, nilaiHuruf: 'AB', bobot: 3.5 },
    ]},
    { semester: 'Genap 22/23', ip: 3.64, totalSks: 22, nilai: [
      { mataKuliah: 'Dasar Sistem', sks: 3, nilaiHuruf: 'A', bobot: 4 },
    ]},
  ],
};

const irs: SiapIrs = {
  semester: 'Ganjil 2025/2026',
  totalSks: 18,
  mataKuliah: [
    { kode: 'PAIK6402', nama: 'Kecerdasan Buatan', sks: 3, ruang: 'A301', jadwal: 'Senin 07:00 - 09:30', status: 'disetujui' },
    { kode: 'PAIK6499', nama: 'Mata Kuliah Tanpa Jadwal', sks: 2, status: 'disetujui' },
  ],
};

function mk(n: Partial<Assignment> & { duedate: number; submissionStatus: Assignment['submissionStatus'] }): Assignment {
  return {
    id: n.id ?? 0,
    name: n.name ?? 'x',
    module: n.module ?? 'assign',
    eventType: n.eventType ?? '',
    duedate: n.duedate,
    overdue: n.overdue ?? false,
    course: n.course ?? 'c',
    courseId: n.courseId ?? 1,
    assignmentId: n.assignmentId,
    courseModuleId: n.courseModuleId,
    submissionStatus: n.submissionStatus,
  };
}

describe('taskStats', () => {
  it('counts submitted, overdue, dueSoon, notSubmitted', () => {
    const assignments = [
      mk({ duedate: NOW / 1000 - 100, submissionStatus: 'graded' }),            // submitted
      mk({ duedate: NOW / 1000 - 100, submissionStatus: 'not_submitted' }),      // overdue
      mk({ duedate: NOW / 1000 + 1000, submissionStatus: 'not_submitted' }),     // dueSoon (<48h)
      mk({ duedate: NOW / 1000 + 999999, submissionStatus: 'not_submitted' }),   // onTrack => notSubmitted only
    ];
    const s = taskStats(assignments, NOW);
    expect(s).toEqual({ notSubmitted: 3, overdue: 1, dueSoon: 1, submitted: 1 });
  });
});

describe('ipTrend', () => {
  it('maps semesters to ip rows', () => {
    expect(ipTrend(khs)).toEqual([
      { semester: 'Gasal 22/23', ip: 3.52 },
      { semester: 'Genap 22/23', ip: 3.64 },
    ]);
  });
  it('returns [] for null', () => expect(ipTrend(null)).toEqual([]));
});

describe('cumulativeSks', () => {
  it('computes a running total', () => {
    expect(cumulativeSks(khs)).toEqual([
      { semester: 'Gasal 22/23', sksKumulatif: 20 },
      { semester: 'Genap 22/23', sksKumulatif: 42 },
    ]);
  });
  it('returns [] for null', () => expect(cumulativeSks(null)).toEqual([]));
});

describe('gradeDistribution', () => {
  it('counts grades per semester, zero-filled', () => {
    const rows = gradeDistribution(khs);
    expect(rows[0]).toMatchObject({ semester: 'Gasal 22/23', A: 1, AB: 1, B: 0 });
    expect(rows[1]).toMatchObject({ semester: 'Genap 22/23', A: 1, AB: 0 });
  });
});

describe('parseSchedule', () => {
  it('parses day + time from jadwal string', () => {
    const items = parseSchedule(irs);
    expect(items[0]).toMatchObject({
      code: 'PAIK6402', courseName: 'Kecerdasan Buatan', day: 'Senin',
      timeStart: '07:00', timeEnd: '09:30', room: 'A301', sks: 3, status: 'disetujui',
    });
  });
  it('keeps unparsable rows with day undefined and raw text', () => {
    const items = parseSchedule(irs);
    expect(items[1].day).toBeUndefined();
    expect(items[1].code).toBe('PAIK6499');
    expect(items[1].jadwalRaw).toBeUndefined(); // empty string -> undefined
  });
  it('returns [] for null', () => expect(parseSchedule(null)).toEqual([]));
});