import type { Course } from '../types';

const TERM_ORDER: Record<string, number> = { Ganjil: 0, Genap: 1, Pendek: 2 };

export function semesterSortKey(s: string | null | undefined): number {
  if (!s) return -1;
  const m = s.match(/(20\d{2}\/\d{4})\s+(Ganjil|Genap|Pendek)/i);
  if (!m) return -1;
  const yearEnd = Number(m[1].slice(5, 9));
  const term = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  // Within an academic year Ganjil is the first semester, so reverse the term
  // order so it sorts ahead of Genap/Pendek when listing newest-first.
  return yearEnd * 10 + (2 - (TERM_ORDER[term] ?? 0));
}

export function groupCoursesBySemester(courses: Course[]): { semester: string; courses: Course[] }[] {
  const map = new Map<string, Course[]>();
  for (const c of courses) {
    const key = c.semester ?? 'Lainnya';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const groups = [...map.entries()].map(([semester, list]) => ({
    semester,
    courses: list.sort((a, b) => a.fullname.localeCompare(b.fullname)),
  }));
  return groups.sort((a, b) => semesterSortKey(b.semester) - semesterSortKey(a.semester));
}