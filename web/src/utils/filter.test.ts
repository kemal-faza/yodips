import { describe, expect, it } from 'vitest';
import { applyFilters, applySort } from './filter';
import type { Assignment } from '../types';

const NOW = new Date(2025, 6, 14, 9, 0, 0).getTime(); // Monday 2025-07-14 09:00
const SEC = 1000;
const HOUR = 3600 * SEC;

function mk(
  id: number,
  duedateSec: number,
  overdue = false,
  name = `tugas-${id}`,
  course = 'Kuliah',
  courseId = 1,
): Assignment {
  return {
    id,
    name,
    module: 'assign',
    eventType: 'due',
    duedate: duedateSec,
    overdue,
    course,
    courseId,
  };
}

describe('applyFilters', () => {
  it('returns everything when filters are unconstrained', () => {
    const items = [mk(1, (NOW + 5 * 24 * HOUR) / SEC), mk(2, (NOW - HOUR) / SEC)];
    const result = applyFilters(items, { search: '', status: 'all', courseId: 'all' }, NOW);
    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it('filters by search case-insensitively using substring match on name', () => {
    const items = [
      mk(1, (NOW + 5 * 24 * HOUR) / SEC, false, 'Tugas Algoritma', 'Kuliah', 1),
      mk(2, (NOW + 5 * 24 * HOUR) / SEC, false, 'Lab Basis Data', 'Kuliah', 1),
    ];
    const result = applyFilters(items, { search: 'ALGO', status: 'all', courseId: 'all' }, NOW);
    expect(result.map((a) => a.id)).toEqual([1]);
    const result2 = applyFilters(items, { search: 'tugas', status: 'all', courseId: 'all' }, NOW);
    expect(result2.map((a) => a.id)).toEqual([1]);
  });

  it('filters by status using assignStatus logic (overdue/dueSoon/onTrack)', () => {
    const items = [
      mk(1, (NOW + 24 * HOUR) / SEC, true), // flagged overdue
      mk(2, (NOW + 24 * HOUR) / SEC, false), // within 48h -> dueSoon
      mk(3, (NOW + 10 * 24 * HOUR) / SEC, false), // far future -> onTrack
    ];
    expect(applyFilters(items, { search: '', status: 'overdue', courseId: 'all' }, NOW).map((a) => a.id)).toEqual([1]);
    expect(applyFilters(items, { search: '', status: 'dueSoon', courseId: 'all' }, NOW).map((a) => a.id)).toEqual([2]);
    expect(applyFilters(items, { search: '', status: 'onTrack', courseId: 'all' }, NOW).map((a) => a.id)).toEqual([3]);
  });

  it('derives status from duedate even without the backend flag (passed deadline -> overdue)', () => {
    const items = [mk(1, (NOW - HOUR) / SEC, false)];
    const result = applyFilters(items, { search: '', status: 'overdue', courseId: 'all' }, NOW);
    expect(result.map((a) => a.id)).toEqual([1]);
  });

  it('filters by courseId, and "all" keeps every course', () => {
    const items = [
      mk(1, (NOW + 5 * 24 * HOUR) / SEC, false, 'a', 'Matkul X', 1),
      mk(2, (NOW + 5 * 24 * HOUR) / SEC, false, 'b', 'Matkul Y', 2),
    ];
    expect(applyFilters(items, { search: '', status: 'all', courseId: 2 }, NOW).map((a) => a.id)).toEqual([2]);
    expect(applyFilters(items, { search: '', status: 'all', courseId: 1 }, NOW).map((a) => a.id)).toEqual([1]);
    expect(applyFilters(items, { search: '', status: 'all', courseId: 'all' }, NOW).map((a) => a.id)).toEqual([1, 2]);
  });

  it('combines search, status and courseId filters', () => {
    const items = [
      mk(1, (NOW - HOUR) / SEC, false, 'Tugas Algoritma', 'Matkul X', 1), // overdue + matches
      mk(2, (NOW + 24 * HOUR) / SEC, false, 'Tugas Algoritma', 'Matkul X', 1), // dueSoon + matches
      mk(3, (NOW - HOUR) / SEC, false, 'Tugas Algoritma', 'Matkul Y', 2), // overdue, wrong course
      mk(4, (NOW - HOUR) / SEC, false, 'Lab Basis Data', 'Matkul X', 1), // overdue, wrong search
    ];
    const result = applyFilters(
      items,
      { search: 'algoritma', status: 'overdue', courseId: 1 },
      NOW,
    );
    expect(result.map((a) => a.id)).toEqual([1]);
  });
});

describe('applySort', () => {
  const items: Assignment[] = [
    mk(1, 3000, false, 'algoritma', 'Matkul Z', 3),
    mk(2, 1000, false, 'basis data', 'Matkul A', 1),
    mk(3, 2000, false, 'compound', 'Matkul B', 2),
    mk(4, 4000, false, 'data mining', 'Matkul A', 1),
  ];

  it('sorts by duedate ascending for deadlineAsc', () => {
    expect(applySort(items, 'deadlineAsc').map((a) => a.id)).toEqual([2, 3, 1, 4]);
  });

  it('sorts by duedate descending for deadlineDesc', () => {
    expect(applySort(items, 'deadlineDesc').map((a) => a.id)).toEqual([4, 1, 3, 2]);
  });

  it('sorts by name using localeCompare for name', () => {
    expect(applySort(items, 'name').map((a) => a.name)).toEqual([
      'algoritma',
      'basis data',
      'compound',
      'data mining',
    ]);
  });

  it('sorts by course, then duedate ascending for course', () => {
    expect(applySort(items, 'course').map((a) => a.id)).toEqual([2, 4, 3, 1]);
  });

  it('returns a new array and never mutates the input', () => {
    const input = [...items];
    const result = applySort(items, 'deadlineAsc');
    expect(result).not.toBe(items);
    expect(items).toEqual(input);
  });
});
