import type { AssignmentStatus, SubmissionStatus } from '../types';

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

export type DisplayTone = 'danger' | 'warn' | 'success' | 'muted';

export interface DisplayStatus {
  label: string;
  tone: DisplayTone;
}

/** Deadline-only display status (used when submission status is unknown). */
export function deadlineStatus(
  overdue: boolean,
  duedateSec: number,
  nowMs: number,
): DisplayStatus {
  const s = assignStatus(overdue, duedateSec, nowMs);
  if (s === 'overdue') return { label: 'Terlambat', tone: 'danger' };
  if (s === 'dueSoon') return { label: 'Segera', tone: 'warn' };
  return { label: 'On track', tone: 'success' };
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
