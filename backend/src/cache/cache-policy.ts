import { defaultStaleTtlMs } from './data-cache';
import { CACHE_LABELS, type CacheLabel } from '../observability/telemetry-contract';

/**
 * Single source of truth for backend cache TTLs (ms).
 * Values are behavior-preserving (verified against Phase 1 upstream logs and
 * the pre-existing hardcoded values at each call site) — centralizing only,
 * never tuning. The 5 keys that previously fell back to the global
 * CACHE_TTL_MS are explicit 300_000 here (the effective default when
 * CACHE_TTL_MS is unset).
 */
export const CachePolicy = {
  KULON_COURSES: 300_000, // was: global CACHE_TTL_MS (effective 300s)
  KULON_ASSIGNMENTS_ALL: 180_000, // was: 180_000 (3 min)
  KULON_ASSIGNMENT_DETAIL: 60_000, // was: 60_000 (1 min)
  KULON_COURSE_CONTENT: 60_000, // was: 60_000 (1 min)
  KULON_SESSKEY: 300_000, // was: SESSKEY_TTL_MS (5 min)
  SIAP_PROFILE: 300_000, // was: global CACHE_TTL_MS (effective 300s)
  SIAP_IRS: 900_000, // was: 15 * 60_000 (15 min)
  SIAP_KHS: 1_800_000, // was: 30 * 60_000 (30 min)
  SIAP_LECTURERS: 86_400_000, // was: 24 * 60 * 60_000 (24 h)
  SIAP_NOTIFICATIONS: 300_000, // was: global CACHE_TTL_MS (effective 300s)
  SIAP_JADWAL: 300_000, // was: global CACHE_TTL_MS (effective 300s)
  SIAP_ABSEN: 300_000, // was: global CACHE_TTL_MS (effective 300s)
  SIAP_IDENTITY: 86_400_000, // was: IDENTITY_TTL_MS (24 h)
  SIAP_TOKEN: 600_000, // was: TOKEN_TTL_MS (10 min)
  AUTH_PROBE: 60_000, // was: PROBE_CACHE_TTL_MS (auth.service)
} as const;

export type CachePolicyKey = keyof typeof CachePolicy;

export type CacheClassification = {
  label: CacheLabel;
  policyKey?: CachePolicyKey;
  swr: boolean;
};

const SUBJECT = '[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]+)*';
const rows = [
  [`${SUBJECT}:kulon:courses`, 'kulon.courses', 'KULON_COURSES', true],
  [`${SUBJECT}:kulon:assignments:all`, 'kulon.assignments_all', 'KULON_ASSIGNMENTS_ALL', true],
  [`${SUBJECT}:kulon:assignment-detail:[0-9]+`, 'kulon.assignment_detail', 'KULON_ASSIGNMENT_DETAIL', true],
  [`${SUBJECT}:kulon:course-content:[0-9]+`, 'kulon.course_content', 'KULON_COURSE_CONTENT', true],
  [`${SUBJECT}:kulon:sesskey:[a-f0-9]{16}`, 'kulon.sesskey', 'KULON_SESSKEY', false],
  [`${SUBJECT}:siap:profile`, 'siap.profile', 'SIAP_PROFILE', true],
  [`${SUBJECT}:siap:irs`, 'siap.irs', 'SIAP_IRS', true],
  [`${SUBJECT}:siap:khs`, 'siap.khs', 'SIAP_KHS', true],
  [`${SUBJECT}:siap:lecturers`, 'siap.lecturers', 'SIAP_LECTURERS', true],
  [`${SUBJECT}:siap:notifications`, 'siap.notifications', 'SIAP_NOTIFICATIONS', true],
  [`${SUBJECT}:siap:jadwal`, 'siap.jadwal', 'SIAP_JADWAL', true],
  [`${SUBJECT}:siap:absen`, 'siap.absen', 'SIAP_ABSEN', true],
  [`${SUBJECT}:siap:identity`, 'siap.identity', 'SIAP_IDENTITY', false],
  [`${SUBJECT}:siap:token`, 'siap.token', 'SIAP_TOKEN', false],
] as const;

const CACHE_LABEL_SET: ReadonlySet<CacheLabel> = new Set(CACHE_LABELS);
const compiledRows: ReadonlyArray<{
  pattern: RegExp;
  classification: CacheClassification;
}> = rows.map(([source, label, policyKey, swr]) => ({
  pattern: new RegExp('^(?:' + source + ')$'),
  classification: { label, policyKey, swr },
}));

/** Classifies a complete, valid cache key; malformed keys fail closed. */
export function classifyCacheKey(key: string): CacheClassification {
  for (const row of compiledRows) {
    const match = row.pattern.exec(key);
    if (match?.[0] === key && CACHE_LABEL_SET.has(row.classification.label)) {
      return row.classification;
    }
  }
  return { label: 'unknown', swr: false };
}

/**
 * SWR window for a payload key: fresh = the policy TTL, stale = derived
 * (defaultStaleTtlMs: ×2, capped at 30 min for long-TTL keys). See spec §2.4.
 */
export function swrWindow(key: CachePolicyKey): { freshTtlMs: number; staleTtlMs: number } {
  const freshTtlMs = CachePolicy[key];
  return { freshTtlMs, staleTtlMs: defaultStaleTtlMs(freshTtlMs) };
}

/** True when a complete cache key is an SWR-eligible payload key. */
export function isSwrKey(key: string): boolean {
  return classifyCacheKey(key).swr;
}
