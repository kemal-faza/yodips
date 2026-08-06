import { describe, expect, it } from 'vitest';
import { assignStatus, assignmentDisplayStatus, deadlineStatus } from './assignment';

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
  it('deadlineStatus maps to display', () => {
    expect(deadlineStatus(false, now / sec + 5 * 24 * 3600, now))
      .toEqual({ label: 'On track', tone: 'success' });
    expect(deadlineStatus(false, now / sec + 24 * 3600, now))
      .toEqual({ label: 'Segera', tone: 'warn' });
  });
});