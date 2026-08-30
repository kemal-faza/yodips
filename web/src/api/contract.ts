/**
 * Single mirror of BACKEND TRUTH for the web client: error codes, response
 * envelope, API paths and the SSO ticket algorithm. The backend
 * (`backend/src/auth/auth.service.ts`) is the source of truth — every code or
 * path used by this client must appear HERE, not inline at call sites.
 */

/** Error codes the backend puts on the `{ message, code }` envelope. */
export const BACKEND_ERROR_CODES = {
  /** Upstream Kulon (Moodle) session expired server-side. */
  KULON_STALE: 'KULON_STALE',
  /** Upstream SIAP session expired server-side. */
  SIAP_STALE: 'SIAP_STALE',
  /** JWT failed validation (bad/expired token). */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** Server-side session record is gone — silent refresh impossible. */
  SESSION_DEAD: 'SESSION_DEAD',
  /** Kode pairing salah / sudah terpakai (POST /api/auth/pair/consume). */
  INVALID_CODE: 'INVALID_CODE',
  /** Kode pairing pernah ada tapi TTL-nya lewat (beda dari INVALID sejak 2026-08-25). */
  EXPIRED_CODE: 'EXPIRED_CODE',
} as const;

export type BackendErrorCode = keyof typeof BACKEND_ERROR_CODES;

/** Service-stale codes: upstream died while the JWT may still be valid. */
const SERVICE_STALE_CODES: ReadonlySet<string> = new Set([
  BACKEND_ERROR_CODES.KULON_STALE,
  BACKEND_ERROR_CODES.SIAP_STALE,
]);

/** Backend route table (kept in one place; no string literals at call sites). */
export const API = {
  auth: {
    me: '/api/auth/me',
    refresh: '/api/auth/refresh',
    login: '/api/auth/login',
    capture: '/api/auth/sso/capture',
    microsoftLogin: '/api/auth/microsoft/login',
    handoff: '/api/auth/session/handoff',
    logout: '/api/auth/logout',
    pairRequest: '/api/auth/pair/request',
    pairConsume: '/api/auth/pair/consume',
    pairStatus: '/api/auth/pair/status',
  },
  kulon: {
    courses: '/api/kulon/courses',
    assignments: '/api/kulon/assignments',
    allAssignments: '/api/kulon/assignments/all',
    assignmentDetail: (id: number) => `/api/kulon/assignments/${id}/detail`,
    courseContent: (courseId: number) => `/api/kulon/courses/${courseId}/content`,
  },
  siap: {
    profile: '/api/siap/profile',
    irs: '/api/siap/irs',
    khs: '/api/siap/khs',
    lecturers: '/api/siap/lecturers',
    jadwal: '/api/siap/jadwal',
    absen: '/api/siap/absen',
    notifications: '/api/siap/notifications',
    markNotification: (id: string) => `/api/siap/notifications/${id}/unread`,
    kehadiran: (id: string) => `/api/siap/kehadiran/${id}`,
    markKehadiran: '/api/siap/kehadiran',
  },
  dashboard: '/api/dashboard',
} as const;

/** The backend error envelope: `{ message?: string; code?: string }`. */
export interface ApiErrorEnvelope {
  message?: string;
  code?: string;
}

/** Extract the envelope from any error-response body shape, defensively. */
export function parseErrorEnvelope(data: unknown): ApiErrorEnvelope {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const { message, code } = data as Record<string, unknown>;
    return {
      ...(typeof message === 'string' ? { message } : {}),
      ...(typeof code === 'string' ? { code } : {}),
    };
  }
  return {};
}

/**
 * True for routes whose data comes from scraping Kulon/SIAP with the user's
 * stored session cookies: a 401 here means the UPSTREAM session went stale,
 * while the JWT itself may be perfectly fine — keep it and let the view show
 * a re-login card instead of a full re-auth.
 */
export function isServiceSessionPath(url: string): boolean {
  return url.startsWith('/api/kulon') || url.startsWith('/api/siap');
}

/** A service-stale marker either by explicit backend code or by route family. */
export function isServiceStale(url: string, code?: string): boolean {
  if (code && SERVICE_STALE_CODES.has(code)) return true;
  return isServiceSessionPath(url);
}

/**
 * SSO bootstrap ticket: base64 of the current unix second — mirrors backend
 * `SSOTicketService`, extension `urls.generateTicket` and mobile
 * `generateSsoTicket()`. Pinned by contract.test.ts so drift breaks a test.
 */
export function buildSsoTicket(nowSeconds = Math.floor(Date.now() / 1000)): string {
  return btoa(String(nowSeconds));
}
