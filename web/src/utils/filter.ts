import type { Assignment, AssignmentStatus } from '../types';
import { assignStatus } from './assignment';

export interface FilterState {
  search: string;
  status: AssignmentStatus | 'all';
  courseId: number | 'all';
}

export type SortKey = 'deadlineAsc' | 'deadlineDesc' | 'name' | 'course';

export function applyFilters(
  assignments: Assignment[],
  filters: FilterState,
  nowMs: number,
): Assignment[] {
  const query = filters.search.toLowerCase();
  return assignments.filter((a) => {
    if (query && !a.name.toLowerCase().includes(query)) return false;
    if (filters.status !== 'all' && assignStatus(a.overdue, a.duedate, nowMs) !== filters.status) {
      return false;
    }
    if (filters.courseId !== 'all' && a.courseId !== filters.courseId) return false;
    return true;
  });
}

export function applySort(assignments: Assignment[], sortKey: SortKey): Assignment[] {
  const sorted = [...assignments];
  switch (sortKey) {
    case 'deadlineAsc':
      return sorted.sort((a, b) => a.duedate - b.duedate);
    case 'deadlineDesc':
      return sorted.sort((a, b) => b.duedate - a.duedate);
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'course':
      return sorted.sort((a, b) => {
        const byCourse = a.course.localeCompare(b.course);
        return byCourse !== 0 ? byCourse : a.duedate - b.duedate;
      });
  }
}
