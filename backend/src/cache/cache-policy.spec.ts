import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { CachePolicy } from './cache-policy';

describe('CachePolicy', () => {
  it('defines every cache key with a positive finite TTL (ms)', () => {
    const keys = [
      'KULON_COURSES', 'KULON_ASSIGNMENTS_ALL', 'KULON_ASSIGNMENT_DETAIL',
      'KULON_COURSE_CONTENT', 'KULON_SESSKEY', 'SIAP_PROFILE', 'SIAP_IRS',
      'SIAP_KHS', 'SIAP_LECTURERS', 'SIAP_NOTIFICATIONS', 'SIAP_JADWAL',
      'SIAP_ABSEN', 'SIAP_IDENTITY', 'SIAP_TOKEN', 'AUTH_PROBE',
    ] as const;
    for (const k of keys) {
      expect(CachePolicy[k]).toBeDefined();
      expect(Number.isFinite(CachePolicy[k])).toBe(true);
      expect(CachePolicy[k]).toBeGreaterThan(0);
    }
  });

  it('keeps behavior-preserving values', () => {
    expect(CachePolicy.KULON_ASSIGNMENTS_ALL).toBe(180_000);
    expect(CachePolicy.SIAP_IRS).toBe(15 * 60_000);
    expect(CachePolicy.SIAP_KHS).toBe(30 * 60_000);
    expect(CachePolicy.SIAP_LECTURERS).toBe(24 * 60 * 60_000);
    expect(CachePolicy.KULON_SESSKEY).toBe(5 * 60_000);
    expect(CachePolicy.SIAP_TOKEN).toBe(10 * 60_000);
    expect(CachePolicy.SIAP_IDENTITY).toBe(24 * 60 * 60_000);
    expect(CachePolicy.AUTH_PROBE).toBe(60_000);
    // The 5 formerly-global keys are explicit 300 s (effective default).
    for (const k of ['KULON_COURSES', 'SIAP_PROFILE', 'SIAP_NOTIFICATIONS', 'SIAP_JADWAL', 'SIAP_ABSEN'] as const) {
      expect(CachePolicy[k]).toBe(300_000);
    }
  });
});
