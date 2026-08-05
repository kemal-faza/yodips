import { describe, expect, it } from 'vitest';
import { groupCoursesBySemester } from './kulon';

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