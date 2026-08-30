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
