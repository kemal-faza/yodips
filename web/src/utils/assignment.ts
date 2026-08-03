import type { Assignment, AssignmentStatus } from '../types';

const DUE_SOON_MS = 48 * 3600 * 1000; // 48 hours

export function assignStatus(
  overdue: boolean,
  duedateSec: number,
  nowMs: number,
): AssignmentStatus {
  const duedateMs = duedateSec * 1000;
  if (overdue || duedateMs < nowMs) return 'overdue';
  if (duedateMs - nowMs <= DUE_SOON_MS) return 'dueSoon';
  return 'onTrack';
}

export function groupByCourse(
  assignments: Assignment[],
): { course: string; courseId: number; items: Assignment[] }[] {
  const map = new Map<number, { course: string; courseId: number; items: Assignment[] }>();
  for (const a of assignments) {
    const key = a.courseId;
    if (!map.has(key)) {
      map.set(key, { course: a.course, courseId: a.courseId, items: [] });
    }
    map.get(key)!.items.push(a);
  }
  return [...map.values()];
}