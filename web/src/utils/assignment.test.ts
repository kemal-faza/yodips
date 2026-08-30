import { describe, expect, it } from 'vitest';
import { assignStatus, assignmentDisplayStatus, isDone, courseActive, matchesKulonFilter, upcomingTasks } from './assignment';
import type { Assignment, Course } from '../types';

const now = Date.now();
const sec = 1000;

describe('assignStatus', () => {
  it('returns overdue when backend flags overdue', () => {
    expect(assignStatus(true, now / sec, now)).toBe('overdue');
  });
  it('returns overdue when deadline has passed even if flag false', () => {
    expect(assignStatus(false, (now - 1000) / sec, now)).toBe('overdue');
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

describe('assignmentDisplayStatus', () => {
  it('submitted assignment => done (success)', () => {
    expect(assignmentDisplayStatus(false, now / sec + 5 * 24 * 3600, 'submitted'))
      .toEqual({ label: 'done', tone: 'success' });
  });
  it('submitted but overdue => still done (success)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'submitted'))
      .toEqual({ label: 'done', tone: 'success' });
  });
  it('graded assignment => done (success)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'graded'))
      .toEqual({ label: 'done', tone: 'success' });
  });
  it('not submitted + overdue => overdue (danger)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'not_submitted'))
      .toEqual({ label: 'overdue', tone: 'danger' });
  });
  it('not submitted + deadline passed but flag false => overdue (danger)', () => {
    expect(assignmentDisplayStatus(false, (now - 1000) / sec, 'not_submitted'))
      .toEqual({ label: 'overdue', tone: 'danger' });
  });
  it('not submitted + on-track => due (warn)', () => {
    expect(assignmentDisplayStatus(false, now / sec + 5 * 24 * 3600, 'not_submitted'))
      .toEqual({ label: 'due', tone: 'warn' });
  });
  it('unknown submission + overdue => overdue (danger)', () => {
    expect(assignmentDisplayStatus(true, now / sec, undefined))
      .toEqual({ label: 'overdue', tone: 'danger' });
  });
  it('unknown submission + on-track => due (warn)', () => {
    expect(assignmentDisplayStatus(false, now / sec + 5 * 24 * 3600, undefined))
      .toEqual({ label: 'due', tone: 'warn' });
  });
});

const mk = (n: Partial<Assignment>): Assignment => ({
  id: 1, name: 'x', module: 'assign', eventType: '', duedate: 1, overdue: false,
  course: 'c', courseId: 1, submissionStatus: 'not_submitted', ...n,
});
const active = (): Course => ({ id: 1, fullname: 'KB', shortname: 'X', idnumber: '', semester: 'Gasal 25/26', timelineStatus: 'inprogress' });
const past = (): Course => ({ id: 2, fullname: 'P', shortname: 'Y', idnumber: '', semester: 'Genap 24/25', timelineStatus: 'past' });

describe('isDone', () => {
  it('true for submitted or graded', () => {
    expect(isDone(mk({ submissionStatus: 'submitted' }))).toBe(true);
    expect(isDone(mk({ submissionStatus: 'graded' }))).toBe(true);
  });
  it('false for not_submitted / unknown', () => {
    expect(isDone(mk({ submissionStatus: 'not_submitted' }))).toBe(false);
    expect(isDone(mk({ submissionStatus: 'unknown' }))).toBe(false);
  });
});

describe('courseActive', () => {
  it('true when the course timelineStatus is inprogress', () => {
    expect(courseActive(mk({ courseId: 1 }), [active(), past()])).toBe(true);
  });
  it('false when the course is past or missing', () => {
    expect(courseActive(mk({ courseId: 2 }), [active(), past()])).toBe(false);
    expect(courseActive(mk({ courseId: 99 }), [active(), past()])).toBe(false);
  });
});

describe('matchesKulonFilter', () => {
  const courses = [active(), past()];
  it('all matches everything', () => {
    expect(matchesKulonFilter('all', mk({}), courses)).toBe(true);
  });
  it('done matches submitted/graded', () => {
    expect(matchesKulonFilter('done', mk({ submissionStatus: 'submitted' }), courses)).toBe(true);
    expect(matchesKulonFilter('done', mk({ submissionStatus: 'not_submitted' }), courses)).toBe(false);
  });
  it('late = overdue AND not done', () => {
    expect(matchesKulonFilter('late', mk({ overdue: true, submissionStatus: 'not_submitted' }), courses)).toBe(true);
    expect(matchesKulonFilter('late', mk({ overdue: true, submissionStatus: 'submitted' }), courses)).toBe(false);
  });
  it('need = not done AND not overdue AND course active', () => {
    expect(matchesKulonFilter('need', mk({ courseId: 1, overdue: false, submissionStatus: 'not_submitted' }), courses)).toBe(true);
    expect(matchesKulonFilter('need', mk({ courseId: 2, overdue: false, submissionStatus: 'not_submitted' }), courses)).toBe(false); // past course
    expect(matchesKulonFilter('need', mk({ overdue: true, submissionStatus: 'not_submitted' }), courses)).toBe(false); // late
  });
});

describe('upcomingTasks', () => {
  const mk = (id: number, over: Partial<Assignment>): Assignment => ({
    id, name: 'N' + id, module: 'assign', eventType: 'due', duedate: 100, overdue: false,
    course: 'C', courseId: 1, ...over,
  });

  it('buang selesai & tanpa deadline, urut deadline naik, batasi limit', () => {
    const rows = [
      mk(1, { duedate: 300 }),
      mk(2, { duedate: 100 }),
      mk(3, { duedate: 200, submissionStatus: 'submitted' }), // done → dibuang
      mk(4, { duedate: 50, overdue: true }), // telat tapi belum selesai → tetap upcoming
      mk(5, { duedate: 0 }),
    ];
    expect(upcomingTasks(rows, [], 2).map((a) => a.id)).toEqual([4, 2]);
  });
});