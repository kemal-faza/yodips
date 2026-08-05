import { describe, expect, it } from 'vitest';
import { assignStatus } from './assignment';

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