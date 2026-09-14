import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatRelativeDate, formatDateTime } from './date';

function mockNow(iso: string) {
  vi.spyOn(Date, 'now').mockReturnValue(new Date(iso).getTime());
}

describe('formatRelativeDate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says X menit lagi for under an hour ahead', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-05T12:05:00').getTime() / 1000))).toBe('5 menit lagi');
  });

  it('says X menit lalu for under an hour behind', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-05T11:50:00').getTime() / 1000))).toBe('10 menit lalu');
  });

  it('says X jam lagi for hours ahead', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-05T15:00:00').getTime() / 1000))).toBe('3 jam lagi');
  });

  it('says X jam lalu for hours behind', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-05T09:00:00').getTime() / 1000))).toBe('3 jam lalu');
  });

  it('says besok for tomorrow', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-06T12:00:00').getTime() / 1000))).toBe('besok');
  });

  it('says kemarin for yesterday', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-04T12:00:00').getTime() / 1000))).toBe('kemarin');
  });

  it('says X hari lagi for future within 30 days', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-10T12:00:00').getTime() / 1000))).toBe('5 hari lagi');
  });

  it('says X hari lalu for past within 30 days', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-08-02T12:00:00').getTime() / 1000))).toBe('3 hari lalu');
  });

  it('formats absolute date beyond 30 days', () => {
    mockNow('2026-08-05T12:00:00');
    expect(formatRelativeDate(Math.floor(new Date('2026-12-25T12:00:00').getTime() / 1000))).toMatch(/^\d{1,2} Des 2026$/);
  });
});

describe('formatDateTime', () => {
  it('formats an absolute date with the time (local)', () => {
    // Construct with local components so the expectation is timezone-independent
    // (CI does not pin TZ; the formatter renders in the viewer's local zone).
    const d = new Date(2026, 8, 12, 14, 30); // 12 Sep 2026 14:30 local
    expect(formatDateTime(Math.floor(d.getTime() / 1000))).toBe('12 Sep 2026 14:30');
  });

  it('returns "Tanpa deadline" for the 0/negative "no deadline" sentinel', () => {
    expect(formatDateTime(0)).toBe('Tanpa deadline');
    expect(formatDateTime(-1)).toBe('Tanpa deadline');
  });
});
