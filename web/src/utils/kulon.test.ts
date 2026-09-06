import { describe, expect, it } from 'vitest';
import type { Course } from '../types';
import { groupCoursesBySemester, semesterProgress } from './kulon';

describe('semesterProgress', () => {
  const course = (
    id: number,
    timelineStatus: Course['timelineStatus'] = 'inprogress',
    progress?: number,
  ): Course => ({
    id, fullname: `C${id}`, shortname: `S${id}`, idnumber: '', semester: '2026/2027 Ganjil', timelineStatus, ...(progress !== undefined ? { progress } : {}),
  });

  it('averages progress over active courses that carry it (unknown skipped)', () => {
    expect(semesterProgress([
      course(1, 'inprogress', 50),
      course(2, 'inprogress', 80),
      course(3, 'inprogress'), // no data → ignored, not counted as 0
    ])).toBe(65);
  });

  it('is null when nothing measurable (no actives, all past, or none with progress)', () => {
    expect(semesterProgress([])).toBeNull();
    expect(semesterProgress([course(1, 'past', 100)])).toBeNull();
    expect(semesterProgress([course(2, 'inprogress')])).toBeNull();
  });
});


describe('groupCoursesBySemester', () => {
  it('groups and sorts newest semester first', () => {
    const courses = [
      { id: 1, fullname: 'A Lama', semester: '2024/2025 Ganjil' },
      { id: 2, fullname: 'B Baru', semester: '2025/2026 Genap' },
      { id: 3, fullname: 'C Tanpa', semester: null },
    ];
    const groups = groupCoursesBySemester(courses as any);
    expect(groups.map((g) => g.semester)).toEqual(['2025/2026 Genap', '2024/2025 Ganjil', 'Lainnya']);
  });
  it('sorts Ganjil before Genap within same year', () => {
    const courses = [
      { id: 1, fullname: 'A Genap', semester: '2025/2026 Genap' },
      { id: 2, fullname: 'B Ganjil', semester: '2025/2026 Ganjil' },
    ];
    const groups = groupCoursesBySemester(courses as any);
    expect(groups.map((g) => g.semester)).toEqual(['2025/2026 Ganjil', '2025/2026 Genap']);
  });
});