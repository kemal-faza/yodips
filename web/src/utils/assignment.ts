import type { AssignmentStatus, SubmissionStatus, Assignment, Course } from '../types';

const DUE_SOON_MS = 48 * 3600 * 1000; // 48 hours

export function assignStatus(
  overdue: boolean,
  duedateSec: number,
  nowMs: number,
): AssignmentStatus {
  // A missing/zero duedate means "no deadline" — never count as overdue.
  if (!duedateSec || duedateSec <= 0) return 'onTrack';
  const duedateMs = duedateSec * 1000;
  if (overdue || duedateMs < nowMs) return 'overdue';
  if (duedateMs - nowMs <= DUE_SOON_MS) return 'dueSoon';
  return 'onTrack';
}

/** Deadline-only display status (used when submission status is unknown). */
export type DisplayTone = 'danger' | 'warn' | 'success' | 'muted';

export interface DisplayStatus {
  label: string;
  tone: DisplayTone;
}

/**
 * Combined status for an assignment.
 * Exactly three states:
 *  - done     (success/green)  — submitted or graded, regardless of timing
 *  - overdue  (danger/red)     — deadline passed and not submitted
 *  - due      (warn/yellow)    — deadline still ahead and not submitted
 */
export function assignmentDisplayStatus(
  overdue: boolean,
  duedateSec: number,
  submission: SubmissionStatus | undefined,
): DisplayStatus {
  if (submission === 'submitted' || submission === 'graded') {
    return { label: 'done', tone: 'success' };
  }
  const s = assignStatus(overdue, duedateSec, Date.now());
  if (s === 'overdue') return { label: 'overdue', tone: 'danger' };
  return { label: 'due', tone: 'warn' };
}

/** True when the assignment is submitted or graded (regardless of timing). */
export function isDone(a: Assignment): boolean {
  return a.submissionStatus === 'submitted' || a.submissionStatus === 'graded';
}

/** True when the assignment's course is in the current (active) semester. */
export function courseActive(a: Assignment, courses: Course[]): boolean {
  return courses.find((c) => c.id === a.courseId)?.timelineStatus === 'inprogress';
}

export type KulonFilterKey = 'all' | 'need' | 'done' | 'late';

/** Kulon dashboard filter predicate — single source of truth for task counts. */
export function matchesKulonFilter(
  key: KulonFilterKey,
  a: Assignment,
  courses: Course[],
): boolean {
  const done = isDone(a);
  if (key === 'all') return true;
  if (key === 'done') return done;
  if (key === 'late') return a.overdue && !done;
  // 'need' = active-semester course, not done, not past deadline
  return !done && !a.overdue && courseActive(a, courses);
}

/** Tugas BELUM selesai ber-deadline positif, terdekat dulu, dibatasi `limit`. */
export function upcomingTasks(
  assignments: Assignment[],
  _courses: Course[],
  limit: number,
): Assignment[] {
  void _courses;
  return assignments
    .filter((a) => !isDone(a) && a.duedate > 0)
    .sort((a, b) => a.duedate - b.duedate)
    .slice(0, Math.max(0, limit));
}
