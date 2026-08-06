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
  it('overdue + not_submitted => Terlambat, belum dikumpulkan (danger)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'not_submitted'))
      .toEqual({ label: 'Terlambat, belum dikumpulkan', tone: 'danger' });
  });
  it('overdue + submitted => Terlambat, sudah dikumpulkan (warn)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'submitted'))
      .toEqual({ label: 'Terlambat, sudah dikumpulkan', tone: 'warn' });
  });
  it('overdue + graded => Terlambat, sudah dikumpulkan (warn)', () => {
    expect(assignmentDisplayStatus(true, now / sec, 'graded'))
      .toEqual({ label: 'Terlambat, sudah dikumpulkan', tone: 'warn' });
  });
  it('on-track + not_submitted => Belum dikumpulkan (muted)', () => {
    expect(assignmentDisplayStatus(false, now / sec + 5 * 24 * 3600, 'not_submitted'))
      .toEqual({ label: 'Belum dikumpulkan', tone: 'muted' });
  });
  it('on-track + submitted => Selesai (success)', () => {
    expect(assignmentDisplayStatus(false, now / sec + 5 * 24 * 3600, 'submitted'))
      .toEqual({ label: 'Selesai', tone: 'success' });
  });
  it('unknown submission falls back to deadline', () => {
    expect(assignmentDisplayStatus(true, now / sec, undefined))
      .toEqual({ label: 'Terlambat', tone: 'danger' });
  });
  it('deadlineStatus maps to display', () => {
    expect(deadlineStatus(false, now / sec + 5 * 24 * 3600, now))
      .toEqual({ label: 'On track', tone: 'success' });
    expect(deadlineStatus(false, now / sec + 24 * 3600, now))
      .toEqual({ label: 'Segera', tone: 'warn' });
  });
});