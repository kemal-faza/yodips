import { describe, expect, it } from 'vitest';
import { assignStatus, groupByCourse } from './assignment';
import type { Assignment } from '../types';

const now = Date.now();
const sec = 1000;

describe('assignStatus', () => {
  it('returns overdue when backend flags overdue', () => {
    expect(assignStatus(true, now / sec, now)).toBe('overdue');
  });
  it('returns dueSoon when duedate within 48h', () => {
    const due = now + 24 * 3600 * sec; // +24h
    expect(assignStatus(false, due / sec, now)).toBe('dueSoon');
  });
  it('returns onTrack when duedate beyond 48h', () => {
    const due = now + 5 * 24 * 3600 * sec; // +5d
    expect(assignStatus(false, due / sec, now)).toBe('onTrack');
  });
  it('returns dueSoon exactly at 48h boundary', () => {
    const due = now + 48 * 3600 * sec; // exactly 48h
    expect(assignStatus(false, due / sec, now)).toBe('dueSoon');
  });
});

describe('groupByCourse', () => {
  it('groups assignments by course preserving order', () => {
    const items: Assignment[] = [
      { id: 1, name: 'A', module: 'assign', eventType: 'due', duedate: 0, overdue: false, course: 'Matkul X', courseId: 1 },
      { id: 2, name: 'B', module: 'assign', eventType: 'due', duedate: 0, overdue: false, course: 'Matkul Y', courseId: 2 },
      { id: 3, name: 'C', module: 'assign', eventType: 'due', duedate: 0, overdue: false, course: 'Matkul X', courseId: 1 },
    ];
    const groups = groupByCourse(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].course).toBe('Matkul X');
    expect(groups[0].items.map((a) => a.id)).toEqual([1, 3]);
    expect(groups[1].course).toBe('Matkul Y');
    expect(groups[1].items.map((a) => a.id)).toEqual([2]);
  });
  it('returns empty array for empty input', () => {
    expect(groupByCourse([])).toEqual([]);
  });
});