import { describe, expect, it } from 'vitest';
import {
  taskStats,
  ipTrend,
  cumulativeSks,
  gradeDistribution,
  parseSchedule,
  parseJadwal,
  semesterXTicks,
  semesterXLabel,
} from './dashboard';
import type { SiapKhs, SiapIrs, SiapJadwal, Assignment, Course } from '../types';

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
  it('buckets need/late/done matching the Kulon filter semantics', () => {
    const courses: Course[] = [
      { id: 1, fullname: 'KB', shortname: 'X', idnumber: '', semester: 'Gasal 25/26', timelineStatus: 'inprogress' },
      { id: 2, fullname: 'P', shortname: 'Y', idnumber: '', semester: 'Genap 24/25', timelineStatus: 'past' },
    ];
    const assignments = [
      mk({ duedate: NOW / 1000 - 100, submissionStatus: 'graded' }),                      // done
      mk({ duedate: NOW / 1000 - 100, submissionStatus: 'not_submitted', overdue: true }), // late
      mk({ duedate: NOW / 1000 + 1000, submissionStatus: 'not_submitted' }),               // need (active course, not overdue)
      mk({ duedate: NOW / 1000 + 1000, submissionStatus: 'not_submitted', courseId: 2 }),  // NOT need (past course)
    ];
    const s = taskStats(assignments, courses);
    expect(s).toEqual({ need: 1, late: 1, done: 1 });
  });
});

// A semester from a current/future term that is not yet graded in KHS
// (backend returns ip 0, totalSks 0, empty nilai). MUST NOT appear in charts.
const khsWithUngraded: SiapKhs = {
  ipk: 3.78,
  semesters: [
    { semester: 'Gasal 22/23', ip: 3.52, totalSks: 20, nilai: [{ mataKuliah: 'Aljabar', sks: 3, nilaiHuruf: 'A', bobot: 4 }] },
    { semester: '2025/2026 Genap', ip: 0, totalSks: 0, nilai: [] },
  ],
};

describe('ipTrend', () => {
  it('maps semesters to ip rows', () => {
    expect(ipTrend(khs)).toEqual([
      { semester: 'Gasal 22/23', ip: 3.52 },
      { semester: 'Genap 22/23', ip: 3.64 },
    ]);
  });
  it('excludes ungraded semesters (ip 0) so the line does not crash to 0', () => {
    expect(ipTrend(khsWithUngraded)).toEqual([{ semester: 'Gasal 22/23', ip: 3.52 }]);
  });
  it('returns [] for null', () => expect(ipTrend(null)).toEqual([]));
});

describe('cumulativeSks', () => {
  it('computes a running total', () => {
    expect(cumulativeSks(khs)).toEqual([
      { semester: 'Gasal 22/23', sksSemester: 20, sksKumulatif: 20 },
      { semester: 'Genap 22/23', sksSemester: 22, sksKumulatif: 42 },
    ]);
  });
  it('excludes ungraded semesters (0 SKS) from the running total', () => {
    expect(cumulativeSks(khsWithUngraded)).toEqual([{ semester: 'Gasal 22/23', sksSemester: 20, sksKumulatif: 20 }]);
  });
  it('returns [] for null', () => expect(cumulativeSks(null)).toEqual([]));
});

describe('gradeDistribution', () => {
  it('counts grades per semester, zero-filled', () => {
    const rows = gradeDistribution(khs);
    expect(rows[0]).toMatchObject({ semester: 'Gasal 22/23', A: 1, AB: 1, B: 0 });
    expect(rows[1]).toMatchObject({ semester: 'Genap 22/23', A: 1, AB: 0 });
  });
  it('excludes ungraded semesters (empty nilai) so bars are not empty', () => {
    const rows = gradeDistribution(khsWithUngraded);
    expect(rows.map((r) => r.semester)).toEqual(['Gasal 22/23']);
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

const jadwalRows: SiapJadwal[] = [
  { no: 1, kode: 'PAIK6402', hari: 'senin', matakuliah: 'Kecerdasan Buatan', ruang: 'A301', waktu: '09:40:00 s/d 12:10:00', sks: 3 },
  { no: 2, kode: 'PAIK6403', hari: 'KAMIS', matakuliah: 'Metode Numerik', ruang: 'A302', waktu: '13:00:00 s/d 15:30:00', sks: 3 },
];

describe('parseJadwal', () => {
  it('normalizes day and parses s/d time with seconds', () => {
    const items = parseJadwal(jadwalRows);
    expect(items[0]).toMatchObject({ code: 'PAIK6402', day: 'Senin', courseName: 'Kecerdasan Buatan', timeStart: '09:40', timeEnd: '12:10', room: 'A301', sks: 3 });
    expect(items[1].day).toBe('Kamis');
  });
  it('parses the dash-separated time form for backward compatibility', () => {
    const items = parseJadwal([{ kode: 'X', hari: 'rabu', matakuliah: 'Statistika', ruang: 'B1', waktu: '13:00-15:30', sks: 2 }]);
    expect(items[0]).toMatchObject({ timeStart: '13:00', timeEnd: '15:30' });
  });
  it('returns [] for empty input', () => expect(parseJadwal([])).toEqual([]));
});

// Regression from the getKhs fix: the CURRENT term now returns enrolled courses
// with SKS but NO grades (empty nilaiHuruf, bobot 0, ip 0). It must NOT appear
// in IP/grade charts (would crash the line to 0), but the SKS cumulative chart
// keeps the old totalSks>0 behavior (includes the current term's SKS).
const khsCurrentTerm: SiapKhs = {
  ipk: 2.73,
  semesters: [
    { semester: 'Gasal 22/23', ip: 3.52, totalSks: 20, nilai: [{ mataKuliah: 'Aljabar', sks: 3, nilaiHuruf: 'A', bobot: 4 }] },
    { semester: '2026/2027 Ganjil', ip: 0, totalSks: 23, nilai: [
      { mataKuliah: 'Sistem Informasi', sks: 3, nilaiHuruf: '', bobot: 0 },
    ]},
  ],
};

describe('getKhs-fix regression', () => {
  it('ipTrend excludes a current term with SKS but no grades', () => {
    expect(ipTrend(khsCurrentTerm)).toEqual([{ semester: 'Gasal 22/23', ip: 3.52 }]);
  });
  it('gradeDistribution excludes a current term with SKS but no grades', () => {
    expect(gradeDistribution(khsCurrentTerm).map((r) => r.semester)).toEqual(['Gasal 22/23']);
  });
  it('cumulativeSks keeps the current term via totalSks>0 filter', () => {
    expect(cumulativeSks(khsCurrentTerm)).toEqual([
      { semester: 'Gasal 22/23', sksSemester: 20, sksKumulatif: 20 },
      { semester: '2026/2027 Ganjil', sksSemester: 23, sksKumulatif: 43 },
    ]);
  });
  it('gradeDistribution tolerates a null nilaiHuruf', () => {
    const khsNull = { ...khs, semesters: [{ ...khs.semesters[0], nilai: [{ mataKuliah: 'X', sks: 2, nilaiHuruf: null as unknown as string, bobot: 4 }] }] };
    expect(() => gradeDistribution(khsNull)).not.toThrow();
  });
});

describe('semesterXTicks / semesterXLabel', () => {
  it('produces integer 0-based tick values for whole-semester labels', () => {
    expect(semesterXTicks(0)).toEqual([]);
    expect(semesterXTicks(1)).toEqual([0]);
    expect(semesterXTicks(4)).toEqual([0, 1, 2, 3]);
  });
  it('maps 0-based tick index to a 1-based integer semester label (no decimals)', () => {
    expect(semesterXLabel(0)).toBe('1');
    expect(semesterXLabel(1)).toBe('2');
    expect(semesterXLabel(3)).toBe('4');
  });
});