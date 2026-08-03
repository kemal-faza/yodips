import { describe, expect, it } from 'vitest';
import { groupByPeriod, PERIOD_LABELS } from './timeline';
import type { Assignment } from '../types';

// Monday 2025-07-14 09:00 local
const NOW = new Date(2025, 6, 14, 9, 0, 0).getTime();
const DAY = 24 * 3600 * 1000;
const sec = (msFromNow: number) => Math.floor((NOW + msFromNow) / 1000);

function mk(id: number, duedateSec: number, overdue = false): Assignment {
  return {
    id,
    name: `tugas-${id}`,
    module: 'assign',
    eventType: 'due',
    duedate: duedateSec,
    overdue,
    course: 'Kuliah',
    courseId: 1,
  };
}

describe('PERIOD_LABELS', () => {
  it('maps every period key to its Indonesian label', () => {
    expect(PERIOD_LABELS).toEqual({
      overdue: 'Terlambat',
      thisWeek: 'Minggu Ini',
      nextWeek: 'Minggu Depan',
      thisMonth: 'Bulan Ini',
      later: 'Nanti',
    });
  });
});

describe('groupByPeriod', () => {
  it('returns an empty array for empty input', () => {
    expect(groupByPeriod([], NOW)).toEqual([]);
  });

  it('returns buckets ordered overdue, thisWeek, nextWeek, thisMonth, later', () => {
    const items = [
      mk(1, sec(1 * DAY)), // +1d  -> thisWeek
      mk(2, sec(15 * DAY)), // +15d -> thisMonth
      mk(3, sec(-1 * DAY)), // -1d  -> overdue
      mk(4, sec(8 * DAY)), // +8d  -> nextWeek
      mk(5, sec(200 * DAY)), // +200d -> later
    ];
    const groups = groupByPeriod(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'thisWeek', 'nextWeek', 'thisMonth', 'later']);
    expect(groups.map((g) => g.label)).toEqual([
      PERIOD_LABELS.overdue,
      PERIOD_LABELS.thisWeek,
      PERIOD_LABELS.nextWeek,
      PERIOD_LABELS.thisMonth,
      PERIOD_LABELS.later,
    ]);
  });

  it('assigns each assignment to the correct bucket', () => {
    const items = [
      mk(1, sec(1 * DAY)), // thisWeek
      mk(2, sec(8 * DAY)), // nextWeek
      mk(3, sec(15 * DAY)), // thisMonth
      mk(4, sec(200 * DAY)), // later
      mk(5, sec(-1 * DAY)), // overdue (deadline passed)
    ];
    const groups = groupByPeriod(items, NOW);
    expect(groups.find((g) => g.key === 'overdue')!.items.map((a) => a.id)).toEqual([5]);
    expect(groups.find((g) => g.key === 'thisWeek')!.items.map((a) => a.id)).toEqual([1]);
    expect(groups.find((g) => g.key === 'nextWeek')!.items.map((a) => a.id)).toEqual([2]);
    expect(groups.find((g) => g.key === 'thisMonth')!.items.map((a) => a.id)).toEqual([3]);
    expect(groups.find((g) => g.key === 'later')!.items.map((a) => a.id)).toEqual([4]);
  });

  it('puts flagged-overdue assignments in the overdue bucket even when duedate is in the future', () => {
    const flagged = mk(1, sec(5 * DAY), true);
    const groups = groupByPeriod([flagged, mk(2, sec(1 * DAY))], NOW);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'thisWeek']);
    expect(groups[0].items.map((a) => a.id)).toEqual([1]);
  });

  it('omits empty buckets (gaps skipped)', () => {
    const items = [
      mk(1, sec(1 * DAY)), // thisWeek
      mk(2, sec(200 * DAY)), // later
    ];
    const groups = groupByPeriod(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['thisWeek', 'later']);
  });

  it('sorts items within each bucket by duedate ascending', () => {
    const items = [
      mk(1, sec(3 * DAY)),
      mk(2, sec(1 * DAY)),
      mk(3, sec(2 * DAY)),
      mk(4, sec(9 * DAY)),
      mk(5, sec(8 * DAY)),
    ];
    const groups = groupByPeriod(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['thisWeek', 'nextWeek']);
    expect(groups[0].items.map((a) => a.id)).toEqual([2, 3, 1]);
    expect(groups[1].items.map((a) => a.id)).toEqual([5, 4]);
  });
});
