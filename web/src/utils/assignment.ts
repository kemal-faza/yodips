import type { AssignmentStatus, SubmissionStatus } from '../types';

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
 * Combined status for an assignment, distinguishing whether it was submitted.
 * Key driver of the dashboard list: "Terlambat, belum dikumpulkan" (danger)
 * vs "Terlambat, sudah dikumpulkan" (warn) is the core ask.
 */
export function assignmentDisplayStatus(
  overdue: boolean,
  duedateSec: number,
  submission: SubmissionStatus | undefined,
): DisplayStatus {
  if (submission === 'submitted' || submission === 'graded') {
    return overdue
      ? { label: 'Terlambat, sudah dikumpulkan', tone: 'warn' }
      : { label: 'Selesai', tone: 'success' };
  }
  if (submission === 'not_submitted') {
    return overdue
      ? { label: 'Terlambat, belum dikumpulkan', tone: 'danger' }
      : { label: 'Belum dikumpulkan', tone: 'muted' };
  }
  // Unknown submission (e.g. legacy list without status) -> deadline view.
  return deadlineStatus(overdue, duedateSec, Date.now());
}
