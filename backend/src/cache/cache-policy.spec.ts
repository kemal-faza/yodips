import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { CachePolicy, classifyCacheKey, isSwrKey, swrWindow } from './cache-policy';

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

  it('keeps every behavior-preserving numeric value', () => {
    expect(CachePolicy).toEqual({
      KULON_COURSES: 300_000,
      KULON_ASSIGNMENTS_ALL: 180_000,
      KULON_ASSIGNMENT_DETAIL: 60_000,
      KULON_COURSE_CONTENT: 60_000,
      KULON_SESSKEY: 300_000,
      SIAP_PROFILE: 300_000,
      SIAP_IRS: 900_000,
      SIAP_KHS: 1_800_000,
      SIAP_LECTURERS: 86_400_000,
      SIAP_NOTIFICATIONS: 300_000,
      SIAP_JADWAL: 300_000,
      SIAP_ABSEN: 300_000,
      SIAP_IDENTITY: 86_400_000,
      SIAP_TOKEN: 600_000,
      AUTH_PROBE: 60_000,
    });
  });
});

describe('swrWindow', () => {
  it('derives fresh from CachePolicy and stale from defaultStaleTtlMs', () => {
    expect(swrWindow('KULON_COURSES')).toEqual({ freshTtlMs: 300_000, staleTtlMs: 600_000 });
    expect(swrWindow('SIAP_KHS')).toEqual({ freshTtlMs: 1_800_000, staleTtlMs: 1_800_000 }); // capped 30min
    expect(swrWindow('SIAP_LECTURERS')).toEqual({ freshTtlMs: 86_400_000, staleTtlMs: 1_800_000 }); // capped
  });
});

describe('classifyCacheKey', () => {
  const validCases = [
    ['123:kulon:courses', { label: 'kulon.courses', policyKey: 'KULON_COURSES', swr: true }],
    ['123:kulon:assignments:all', { label: 'kulon.assignments_all', policyKey: 'KULON_ASSIGNMENTS_ALL', swr: true }],
    ['123:kulon:assignment-detail:42', { label: 'kulon.assignment_detail', policyKey: 'KULON_ASSIGNMENT_DETAIL', swr: true }],
    ['123:kulon:course-content:456', { label: 'kulon.course_content', policyKey: 'KULON_COURSE_CONTENT', swr: true }],
    ['123:kulon:sesskey:abcdef0123456789', { label: 'kulon.sesskey', policyKey: 'KULON_SESSKEY', swr: false }], // gitleaks:allow test fixture
    ['123:siap:profile', { label: 'siap.profile', policyKey: 'SIAP_PROFILE', swr: true }],
    ['123:siap:irs', { label: 'siap.irs', policyKey: 'SIAP_IRS', swr: true }],
    ['123:siap:khs', { label: 'siap.khs', policyKey: 'SIAP_KHS', swr: true }],
    ['123:siap:lecturers', { label: 'siap.lecturers', policyKey: 'SIAP_LECTURERS', swr: true }],
    ['123:siap:notifications', { label: 'siap.notifications', policyKey: 'SIAP_NOTIFICATIONS', swr: true }],
    ['123:siap:jadwal', { label: 'siap.jadwal', policyKey: 'SIAP_JADWAL', swr: true }],
    ['123:siap:absen', { label: 'siap.absen', policyKey: 'SIAP_ABSEN', swr: true }],
    ['123:siap:identity', { label: 'siap.identity', policyKey: 'SIAP_IDENTITY', swr: false }],
    ['123:siap:token', { label: 'siap.token', policyKey: 'SIAP_TOKEN', swr: false }],
  ] as const;

  for (const [key, expected] of validCases) {
    it(`classifies ${key} and preserves its SWR flag`, () => {
      expect(classifyCacheKey(key)).toEqual(expected);
      expect(isSwrKey(key)).toBe(expected.swr);
    });
  }

  const invalidCases = [
    ['missing subject', 'kulon:courses'],
    ['missing subject separator', 'xkulon:courses'],
    ['empty subject atom', 'x::siap:profile'],
    ['wrong family', 'x:kulon:assignments'],
    ['extra family suffix', 'x:siap:profile:extra'],
    ['invalid numeric assignment suffix', 'x:kulon:assignment-detail:not-a-number'],
    ['invalid numeric content suffix', 'x:kulon:course-content:1.5'],
    ['resource suffix on assignment', 'x:kulon:assignment-detail:42:resource'],
    ['resource suffix on content', 'x:kulon:course-content:42:resource'],
    ['short fingerprint', 'x:kulon:sesskey:abcdef012345678'], // gitleaks:allow test fixture
    ['long fingerprint', 'x:kulon:sesskey:abcdef01234567890'], // gitleaks:allow test fixture
    ['non-hex fingerprint', 'x:kulon:sesskey:abcdef012345678g'], // gitleaks:allow test fixture
    ['uppercase fingerprint', 'x:kulon:sesskey:ABCDEF0123456789'], // gitleaks:allow test fixture
    ['fingerprint resource suffix', 'x:kulon:sesskey:abcdef0123456789:resource'],
    ['whitespace in subject', 'x y:siap:profile'],
    ['whitespace in subject atom', 'x:tenant :siap:profile'],
    ['trailing whitespace', 'x:siap:profile '],
    ['control character in subject', 'x:\t:siap:profile'],
    ['control character in family', 'x:siap:\rprofile'],
    ['embedded substring', 'x:prefix-kulon:courses'],
    ['substring with suffix', 'prefix-kulon:courses-suffix'],
    ['uncached assignments feed', 'x:kulon:assignments'],
    ['auth probe is not a DataCache family', 'x:auth:probe'],
  ] as const;

  it.each(invalidCases)('fails closed for %s', (_reason, key) => {
    expect(classifyCacheKey(key)).toEqual({ label: 'unknown', swr: false });
    expect(isSwrKey(key)).toBe(false);
  });

  it('rejects valid-looking keys with a final newline despite RegExp $ behavior', () => {
    for (const key of ['x:kulon:courses\n', 'x:siap:profile\r\n']) {
      expect(classifyCacheKey(key)).toEqual({ label: 'unknown', swr: false });
      expect(isSwrKey(key)).toBe(false);
    }
  });

  it('supports valid multi-atom subjects without substring matching', () => {
    expect(classifyCacheKey('microsoft:abc_DEF-12:siap:token')).toEqual({
      label: 'siap.token',
      policyKey: 'SIAP_TOKEN',
      swr: false,
    });
    expect(classifyCacheKey('org~2:tenant-01:kulon:assignment-detail:42')).toEqual({
      label: 'kulon.assignment_detail',
      policyKey: 'KULON_ASSIGNMENT_DETAIL',
      swr: true,
    });
  });

  it('does not classify a family name embedded in a larger key', () => {
    expect(isSwrKey('prefix-kulon:courses-suffix')).toBe(false);
  });
});
