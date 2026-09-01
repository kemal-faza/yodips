export const TELEMETRY_SCHEMA_VERSION = 1 as const;

export const CACHE_LABELS = [
  'kulon.courses',
  'kulon.assignments_all',
  'kulon.assignment_detail',
  'kulon.course_content',
  'kulon.sesskey',
  'siap.profile',
  'siap.irs',
  'siap.khs',
  'siap.lecturers',
  'siap.notifications',
  'siap.jadwal',
  'siap.absen',
  'siap.identity',
  'siap.token',
  'auth.probe',
  'unknown',
] as const;

export const CACHE_BACKENDS = ['memory', 'redis'] as const;
export const CACHE_READ_OUTCOMES = ['fresh', 'stale', 'hit', 'miss', 'expired'] as const;
export const CACHE_REFRESH_OUTCOMES = ['started', 'ok', 'error', 'hard_expire'] as const;
export const CACHE_REFRESH_REASONS = ['dead-session', 'transient', 'unexpected', 'unknown'] as const;

export const UPSTREAM_SERVICES = ['kulon', 'siap', 'siap-api', 'sso', 'microsoft'] as const;
export const UPSTREAM_OUTCOMES = ['ok', 'http_error', 'network_error', 'parse_error', 'stale'] as const;
export const UPSTREAM_REASONS = [
  'redirect-loop',
  'http-not-ok',
  'login-redirect',
  'html-content-type',
  'malformed-json',
  'no-cookie',
  'api-credential',
  'api-endpoint',
  'no-api-upstream',
  'no-emailSso',
  'non-json-process',
  'fetch-threw',
  'stale',
  'unknown',
] as const;

export const UPSTREAM_HTTP_ERROR_REASONS = ['http-not-ok'] as const;
export const UPSTREAM_NETWORK_ERROR_REASONS = ['fetch-threw', 'redirect-loop'] as const;
export const UPSTREAM_PARSE_ERROR_REASONS = [
  'html-content-type',
  'malformed-json',
  'non-json-process',
  'unknown',
] as const;
export const UPSTREAM_STALE_REASONS = [
  'login-redirect',
  'no-cookie',
  'api-credential',
  'api-endpoint',
  'no-api-upstream',
  'no-emailSso',
  'stale',
  'unknown',
] as const;

export const UPSTREAM_ROUTES = [
  { service: 'kulon', operation: 'session_probe', route: 'GET /my/' },
  { service: 'siap', operation: 'session_probe', route: 'GET /pages/mhs/dashboard' },
  { service: 'kulon', operation: 'session_identity', route: 'GET /my/' },
  { service: 'kulon', operation: 'profile_identity', route: 'GET /user/profile.php' },
  { service: 'kulon', operation: 'assignments_index', route: 'GET /mod/assign/index.php' },
  { service: 'kulon', operation: 'quiz_index', route: 'GET /mod/quiz/index.php' },
  { service: 'kulon', operation: 'assignment_detail', route: 'GET /mod/assign/view.php' },
  { service: 'kulon', operation: 'course_content', route: 'GET /course/view.php' },
  { service: 'kulon', operation: 'sesskey', route: 'GET /my/' },
  { service: 'kulon', operation: 'ajax', route: 'POST /lib/ajax/service.php' },
  { service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard' },
  {
    service: 'siap',
    operation: 'attendance_page',
    route: 'POST /jadwal_mahasiswa/mhs/jadwal/get_absen',
  },
  {
    service: 'siap',
    operation: 'notification_action',
    route: 'POST /pages/mhs/dashboard/ajax/unread',
  },
  {
    service: 'siap',
    operation: 'qr_presence',
    route: 'POST /master_perkuliahan/mhs/absensi/process/',
  },
  { service: 'siap-api', operation: 'mintToken', route: 'POST /index.php/mahasiswa_sso' },
  { service: 'siap-api', operation: 'semester_aktif', route: 'POST /index.php/semester_aktif' },
  { service: 'siap-api', operation: 'data_mahasiswa', route: 'POST /index.php/data_mahasiswa' },
  { service: 'siap-api', operation: 'v2/lihat_irs', route: 'POST /index.php/v2/lihat_irs' },
  { service: 'siap-api', operation: 'v2/daftar_khs', route: 'POST /index.php/v2/daftar_khs' },
  { service: 'siap-api', operation: 'v2/lihat_khs', route: 'POST /index.php/v2/lihat_khs' },
  { service: 'siap-api', operation: 'jadwal', route: 'POST /index.php/jadwal' },
  { service: 'siap-api', operation: 'absen', route: 'POST /index.php/absen' },
  { service: 'siap-api', operation: 'pengumuman', route: 'POST /index.php/pengumuman' },
  { service: 'sso', operation: 'login_page', route: 'GET /auth/user/login' },
  { service: 'sso', operation: 'session_exchange', route: 'POST /sso/auth_v2' },
  { service: 'microsoft', operation: 'token_exchange', route: 'POST /oauth2/v2.0/token' },
] as const;

export type CacheLabel = (typeof CACHE_LABELS)[number];
export type CacheBackend = (typeof CACHE_BACKENDS)[number];
export type CacheReadOutcome = (typeof CACHE_READ_OUTCOMES)[number];
export type CacheRefreshOutcome = (typeof CACHE_REFRESH_OUTCOMES)[number];
export type CacheRefreshReason = (typeof CACHE_REFRESH_REASONS)[number];
export type UpstreamService = (typeof UPSTREAM_SERVICES)[number];
export type UpstreamOutcome = (typeof UPSTREAM_OUTCOMES)[number];
export type UpstreamReason = (typeof UPSTREAM_REASONS)[number];
export type UpstreamRoute = (typeof UPSTREAM_ROUTES)[number];

type CacheReadBase = {
  event: 'cache.read';
  cache: CacheLabel;
  backend: CacheBackend;
  durationMs: number;
};

export type CacheReadEventInput =
  | (CacheReadBase & { outcome: 'hit' | 'miss'; ageMs?: never; freshTtlMs?: never; staleTtlMs?: never })
  | (CacheReadBase & {
      outcome: 'miss';
      freshTtlMs: number;
      staleTtlMs: number;
      ageMs?: never;
    })
  | (CacheReadBase & {
      outcome: 'fresh' | 'stale' | 'expired';
      ageMs: number;
      freshTtlMs: number;
      staleTtlMs: number;
    });

type CacheRefreshBase = {
  event: 'cache.refresh';
  cache: CacheLabel;
  backend: CacheBackend;
  freshTtlMs: number;
  staleTtlMs: number;
};

export type CacheRefreshEventInput =
  | (CacheRefreshBase & { outcome: 'started'; durationMs?: never; reason?: never })
  | (CacheRefreshBase & { outcome: 'ok'; durationMs: number; reason?: never })
  | (CacheRefreshBase & {
      outcome: 'error';
      durationMs: number;
      reason: CacheRefreshReason;
    })
  | (CacheRefreshBase & {
      outcome: 'hard_expire';
      durationMs: number;
      reason: 'dead-session';
    });

type UpstreamRequestBase = UpstreamRoute & {
  event: 'upstream.request';
  durationMs: number;
};

type UpstreamStaleReason = (typeof UPSTREAM_STALE_REASONS)[number];

export type UpstreamRequestEventInput = UpstreamRequestBase &
  (
    | { outcome: 'ok'; status: number; reason?: never }
    | { outcome: 'http_error'; status: number; reason: (typeof UPSTREAM_HTTP_ERROR_REASONS)[number] }
    | { outcome: 'network_error'; reason: (typeof UPSTREAM_NETWORK_ERROR_REASONS)[number]; status?: never }
    | {
        outcome: 'parse_error';
        status: number;
        reason: (typeof UPSTREAM_PARSE_ERROR_REASONS)[number];
      }
    | { outcome: 'stale'; status: number; reason: UpstreamStaleReason }
  );

export type TelemetryEventInput =
  | CacheReadEventInput
  | CacheRefreshEventInput
  | UpstreamRequestEventInput;

export const TELEMETRY_EVENT_SHAPES = {
  'cache.read': {
    plain: {
      outcomes: ['hit', 'miss'],
      required: ['cache', 'backend', 'outcome', 'durationMs'],
      forbidden: ['ageMs', 'freshTtlMs', 'staleTtlMs'],
    },
    staleMiss: {
      outcomes: ['miss'],
      required: ['cache', 'backend', 'outcome', 'freshTtlMs', 'staleTtlMs', 'durationMs'],
      forbidden: ['ageMs'],
    },
    existing: {
      outcomes: ['fresh', 'stale', 'expired'],
      required: ['cache', 'backend', 'outcome', 'ageMs', 'freshTtlMs', 'staleTtlMs', 'durationMs'],
      forbidden: [],
    },
  },
  'cache.refresh': {
    started: {
      outcomes: ['started'],
      required: ['cache', 'backend', 'outcome', 'freshTtlMs', 'staleTtlMs'],
      forbidden: ['durationMs', 'reason'],
    },
    ok: {
      outcomes: ['ok'],
      required: ['cache', 'backend', 'outcome', 'freshTtlMs', 'staleTtlMs', 'durationMs'],
      forbidden: ['reason'],
    },
    terminal: {
      outcomes: ['error', 'hard_expire'],
      required: ['cache', 'backend', 'outcome', 'freshTtlMs', 'staleTtlMs', 'durationMs', 'reason'],
      forbidden: [],
    },
  },
  'upstream.request': {
    ok: {
      outcomes: ['ok'],
      required: ['service', 'operation', 'route', 'outcome', 'status', 'durationMs'],
      forbidden: ['reason'],
    },
    httpError: {
      outcomes: ['http_error'],
      required: ['service', 'operation', 'route', 'outcome', 'status', 'durationMs', 'reason'],
      forbidden: [],
    },
    networkError: {
      outcomes: ['network_error'],
      required: ['service', 'operation', 'route', 'outcome', 'durationMs', 'reason'],
      forbidden: ['status'],
    },
    parseError: {
      outcomes: ['parse_error'],
      required: ['service', 'operation', 'route', 'outcome', 'status', 'durationMs', 'reason'],
      forbidden: [],
    },
    stale: {
      outcomes: ['stale'],
      required: ['service', 'operation', 'route', 'outcome', 'status', 'durationMs', 'reason'],
      forbidden: [],
    },
  },
} as const;

export const TELEMETRY_VALIDATION_RULES = {
  numeric: {
    kind: 'safe-integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  },
  upstreamStatus: {
    minimum: 100,
    maximum: 599,
    requiredFor: ['ok', 'http_error', 'parse_error', 'stale'],
    forbiddenFor: ['network_error'],
  },
  cacheRead: {
    authProbe: {
      cache: 'auth.probe',
      backend: 'memory',
      outcomes: ['hit', 'miss'],
      forbidden: ['ageMs', 'freshTtlMs', 'staleTtlMs'],
    },
  },
  cacheRefresh: {
    hardExpire: {
      requiredReason: 'dead-session',
    },
  },
  upstreamReasons: {
    httpError: UPSTREAM_HTTP_ERROR_REASONS,
    networkError: UPSTREAM_NETWORK_ERROR_REASONS,
    parseError: UPSTREAM_PARSE_ERROR_REASONS,
    stale: UPSTREAM_STALE_REASONS,
  },
} as const;
