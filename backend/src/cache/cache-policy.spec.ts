import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { CachePolicy, isSwrKey, swrWindow, SWR_KEYS } from './cache-policy';

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

describe('swrWindow', () => {
  it('derives fresh from CachePolicy and stale from defaultStaleTtlMs', () => {
    expect(swrWindow('KULON_COURSES')).toEqual({ freshTtlMs: 300_000, staleTtlMs: 600_000 });
    expect(swrWindow('SIAP_KHS')).toEqual({ freshTtlMs: 1_800_000, staleTtlMs: 1_800_000 }); // capped 30min
    expect(swrWindow('SIAP_LECTURERS')).toEqual({ freshTtlMs: 86_400_000, staleTtlMs: 1_800_000 }); // capped
  });
});

describe('SWR_KEYS', () => {
  it('covers exactly the 11 payload key prefixes', () => {
    expect(SWR_KEYS).toEqual(new Set([
      'kulon:courses',
      'kulon:assignments:all',
      'kulon:assignment-detail:',
      'kulon:course-content:',
      'siap:profile',
      'siap:irs',
      'siap:khs',
      'siap:lecturers',
      'siap:notifications',
      'siap:jadwal',
      'siap:absen',
    ]));
  });
  it('excludes credentials, probe, and the uncached assignments feed (negative guard)', () => {
    expect(SWR_KEYS.has('kulon:sesskey')).toBe(false);
    expect(SWR_KEYS.has('siap:identity')).toBe(false);
    expect(SWR_KEYS.has('siap:token')).toBe(false);
    // AUTH_PROBE is never a DataCache key (auth.service private Map) — but guard it too
    expect(SWR_KEYS.has('auth:probe')).toBe(false);
    // Feed key that must stay uncached/fresh for the poller
    expect(SWR_KEYS.has('kulon:assignments')).toBe(false);
  });
  it('isSwrKey matches by exact key and by prefix for suffixed keys', () => {
    expect(isSwrKey('u1:kulon:courses')).toBe(true);
    expect(isSwrKey('u1:kulon:assignment-detail:123')).toBe(true);
    expect(isSwrKey('u1:kulon:course-content:456')).toBe(true);
    expect(isSwrKey('u1:siap:khs')).toBe(true);
    expect(isSwrKey('u1:kulon:sesskey:abc')).toBe(false);
    expect(isSwrKey('u1:siap:token')).toBe(false);
  });
});
