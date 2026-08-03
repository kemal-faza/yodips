import type { Assignment } from '../types';

export type PeriodKey = 'overdue' | 'thisWeek' | 'nextWeek' | 'thisMonth' | 'later';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  overdue: 'Terlambat',
  thisWeek: 'Minggu Ini',
  nextWeek: 'Minggu Depan',
  thisMonth: 'Bulan Ini',
  later: 'Nanti',
};

export interface PeriodGroup {
  key: PeriodKey;
  label: string;
  items: Assignment[];
}

const DAY_MS = 24 * 3600 * 1000;

/** Order in which buckets are emitted. Empty buckets are omitted. */
const BUCKET_ORDER: PeriodKey[] = ['overdue', 'thisWeek', 'nextWeek', 'thisMonth', 'later'];

export function groupByPeriod(assignments: Assignment[], nowMs: number): PeriodGroup[] {
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  // Monday based week: monday = start of this week (0 = Monday .. 6 = Sunday).
  const weekday = (startOfToday.getDay() + 6) % 7;
  const thisMondayMs = startOfTodayMs - weekday * DAY_MS;
  const nextMondayMs = thisMondayMs + 7 * DAY_MS;
  const plus14Ms = thisMondayMs + 14 * DAY_MS;

  const firstNextMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth() + 1, 1);
  const firstNextMonthMs = firstNextMonth.getTime();

  const buckets = new Map<PeriodKey, Assignment[]>(BUCKET_ORDER.map((key) => [key, []]));

  for (const a of assignments) {
    const dueMs = a.duedate * 1000;
    let key: PeriodKey;
    if (a.overdue || dueMs < startOfTodayMs) key = 'overdue';
    else if (dueMs < nextMondayMs) key = 'thisWeek';
    else if (dueMs < plus14Ms) key = 'nextWeek';
    else if (dueMs < firstNextMonthMs) key = 'thisMonth';
    else key = 'later';
    buckets.get(key)!.push(a);
  }

  const groups: PeriodGroup[] = [];
  for (const key of BUCKET_ORDER) {
    const items = buckets.get(key)!;
    if (items.length === 0) continue;
    items.sort((a, b) => a.duedate - b.duedate);
    groups.push({ key, label: PERIOD_LABELS[key], items });
  }
  return groups;
}
