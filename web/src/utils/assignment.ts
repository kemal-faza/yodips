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