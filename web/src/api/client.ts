import axios, { AxiosInstance } from 'axios';
import type {
  Assignment,
  AssignmentDetail,
  CaptureResult,
  Course,
  KehadiranResult,
  KulonCourseContent,
  PairConsumeResult,
  PairRequestResult,
  PairStatusResult,
  SiapAbsenItem,
  SiapIrs,
  SiapJadwal,
  SiapKehadiran,
  SiapKhs,
  SiapLecturer,
  SiapNotifications,
  SiapProfile,
  User,
} from '../types';
import { emitReauthRequested, emitTokenRefreshed } from '../lib/reauth';
import { createTokenRefresher } from './token-refresher';
import { API, isServiceStale, parseErrorEnvelope } from './contract';
import { getCached, invalidate } from './cache';

const TOKEN_KEY = 'sso_token';

/** Frontend cache TTLs (ms). Independent of backend TTLs. fresh→stale. */
const CACHE = {
  courses: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  assignments: { freshTtl: 3 * 60_000, staleTtl: 15 * 60_000 },
  assignmentDetail: { freshTtl: 60_000, staleTtl: 10 * 60_000 },
  courseContent: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  profile: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  khs: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  irs: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  jadwal: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  lecturers: { freshTtl: 60 * 60_000, staleTtl: 24 * 60 * 60_000 },
  absen: { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 },
  kehadiran: { freshTtl: 60_000, staleTtl: 5 * 60_000 },
  notifications: { freshTtl: 60_000, staleTtl: 5 * 60_000 },
} as const;

export interface DashboardSliceError { status: number; message: string; }
export interface DashboardPayload {
  profile: SiapProfile | null;
  khs: SiapKhs | null;
  irs: SiapIrs | null;
  jadwal: SiapJadwal[];
  courses: Course[];
  assignments: Assignment[];
  errors: Partial<Record<'profile'|'khs'|'irs'|'jadwal'|'courses'|'assignments', DashboardSliceError>>;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
});

/**
 * Single-flight silent refresh. A dashboard firing parallel data calls on
 * token expiry must produce exactly ONE POST /api/auth/refresh — every 401
 * interceptor awaits the same in-flight promise (parity with mobile's
 * inflightRefresh).
 */
const refreshOnce = createTokenRefresher(async () => {
  const { data } = await apiClient.post<{ accessToken: string }>(
    '/api/auth/refresh',
  );
  return data.accessToken;
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? '';
    const method: string = (error?.config?.method ?? 'get').toLowerCase();
    if (status === 401) {
      // The refresh endpoint's OWN 401 must be terminal — never re-refresh (loop).
      // /api/auth/logout's own 401 is equally terminal: the session is already
      // gone or the token invalid, and a silent refresh would re-mint the very
      // JWT the logout is destroying (refresh recursion on logout).
      if (url === API.auth.refresh || url === API.auth.logout) {
        return Promise.reject(error);
      }
      const alreadyRetried = (error.config as { _retried?: boolean } | undefined)?._retried;
      if (!alreadyRetried) {
        // Silent refresh FIRST — this is also the probe that distinguishes
        // "JWT invalid" from "upstream session stale" on /api/kulon|/api/siap:
        // the backend's JwtAuthGuard and StaleUpstreamError both emit a bare
        // 401 `{ message }` with no code, so the envelope cannot tell them
        // apart. Only refresh() carries the code (INVALID_TOKEN / SESSION_DEAD).
        let newToken: string;
        try {
          // Single-flight: concurrent 401s share one refresh POST.
          newToken = await refreshOnce();
        } catch (refreshErr) {
          const refreshStatus = (refreshErr as any)?.response?.status;
          if (refreshStatus === 401) {
            // Genuinely dead session (SESSION_DEAD / INVALID_TOKEN): wipe the
            // token and re-auth — INCLUDING for service paths, whose bare 401
            // would otherwise be misread as "upstream stale" and strand the
            // user with no re-login path.
            localStorage.removeItem(TOKEN_KEY);
            emitReauthRequested();
          }
          // Network/5xx: keep the token; server down != dead session.
          return Promise.reject(error);
        }
        localStorage.setItem(TOKEN_KEY, newToken);
        emitTokenRefreshed(newToken); // keep auth store in sync
        // Refresh succeeded → the JWT is alive. A 401 on a service path with
        // a valid JWT is upstream-stale (view shows the re-login card); a 401
        // on a non-service path with a valid JWT is an unexpected auth failure
        // — retry once so a transient race (e.g. refresh just rotated the
        // token) settles before we treat it as fatal.
        const serviceStale = isServiceStale(url, parseErrorEnvelope(error?.response?.data).code);
        if (serviceStale) {
          // Upstream session expired, JWT fine — keep token, view handles.
          return Promise.reject(error);
        }
        // Only retry idempotent requests; a POST must not be re-sent.
        if (method === 'get' || method === 'head') {
          return apiClient.request({ ...error.config, _retried: true });
        }
        return Promise.reject(error);
      }
      // Already retried with a fresh token and still 401: either an upstream
      // session gone stale mid-flight (service path — keep token, view
      // handles) or a genuine auth failure on a non-service path.
      const { code } = parseErrorEnvelope(error?.response?.data);
      if (isServiceStale(url, code)) {
        return Promise.reject(error);
      }
      localStorage.removeItem(TOKEN_KEY);
      emitReauthRequested();
    }
    return Promise.reject(error);
  },
);

export async function capture(): Promise<CaptureResult> {
  const { data } = await apiClient.post<CaptureResult>(API.auth.capture);
  return data;
}

export async function me(): Promise<User> {
  const { data } = await apiClient.get<User>(API.auth.me);
  return data;
}

/** POST /api/auth/refresh with the current (possibly expired) JWT. Throws on failure. */
export async function refreshToken(): Promise<string> {
  const { data } = await apiClient.post<{ accessToken: string }>('API.auth.refresh');
  return data.accessToken;
}

/** Server-side logout: revoke the session so no leaked JWT can be refreshed.
 *  Best-effort by callers; the response interceptor treats /logout's own 401
 *  as terminal (session already dead) and never triggers a silent refresh. */
export async function logoutSession(): Promise<void> {
  await apiClient.post(API.auth.logout);
}

export async function getAssignments(): Promise<Assignment[]> {
  return getCached('kulon:upcoming', async () => {
    const { data } = await apiClient.get<Assignment[]>(API.kulon.assignments);
    return data;
  }, CACHE.assignments);
}

export async function getAllAssignments(): Promise<Assignment[]> {
  return getCached('kulon:assignments', async () => {
    const { data } = await apiClient.get<Assignment[]>(API.kulon.allAssignments);
    return data;
  }, CACHE.assignments);
}

export async function getCourses(): Promise<Course[]> {
  return getCached('kulon:courses', async () => {
    const { data } = await apiClient.get<Course[]>(API.kulon.courses);
    return data;
  }, CACHE.courses);
}

export async function getCourseContent(courseId: number): Promise<KulonCourseContent> {
  return getCached(`kulon:content:${courseId}`, async () => {
    const { data } = await apiClient.get<KulonCourseContent>(API.kulon.courseContent(courseId));
    return data;
  }, CACHE.courseContent);
}

export async function getAssignmentDetail(assignmentId: number, cmid: number): Promise<AssignmentDetail> {
  return getCached(`kulon:detail:${assignmentId}:${cmid}`, async () => {
    const { data } = await apiClient.get<AssignmentDetail>(
      API.kulon.assignmentDetail(assignmentId),
      { params: { cmid } },
    );
    return data;
  }, CACHE.assignmentDetail);
}

export async function getSiapProfile(): Promise<SiapProfile> {
  return getCached('siap:profile', async () => {
    const { data } = await apiClient.get<SiapProfile>(API.siap.profile);
    return data;
  }, CACHE.profile);
}

export async function getSiapIrs(): Promise<SiapIrs> {
  return getCached('siap:irs', async () => {
    const { data } = await apiClient.get<SiapIrs>(API.siap.irs);
    return data;
  }, CACHE.irs);
}

export async function getSiapKhs(): Promise<SiapKhs> {
  return getCached('siap:khs', async () => {
    const { data } = await apiClient.get<SiapKhs>(API.siap.khs);
    return data;
  }, CACHE.khs);
}

export async function getSiapJadwal(): Promise<SiapJadwal[]> {
  return getCached('siap:jadwal', async () => {
    const { data } = await apiClient.get<SiapJadwal[]>(API.siap.jadwal);
    return data;
  }, CACHE.jadwal);
}

export async function getNotifications(): Promise<SiapNotifications> {
  return getCached('siap:notifications', async () => {
    const { data } = await apiClient.get<SiapNotifications>(API.siap.notifications);
    return data;
  }, CACHE.notifications);
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(API.siap.markNotification(id));
  invalidate('siap:notifications');
}

/** Minta kode pairing (JWT-guarded; axios interceptor menyuntik Bearer). */
export async function pairRequest(): Promise<PairRequestResult> {
  const { data } = await apiClient.post<PairRequestResult>(API.auth.pairRequest);
  return data;
}

/** Tukar kode pairing dengan JWT sesi yang sama. */
export async function pairConsume(code: string): Promise<PairConsumeResult> {
  const { data } = await apiClient.post<PairConsumeResult>(API.auth.pairConsume, { code });
  return data;
}

/** Polling status kode pairing milik sendiri (read-only, tak mengonsumsi). */
export async function pairStatus(code: string): Promise<PairStatusResult> {
  const { data } = await apiClient.get<PairStatusResult>(API.auth.pairStatus, {
    params: { code },
  });
  return data;
}

export async function getSiapLecturers(): Promise<SiapLecturer[]> {
  return getCached('siap:lecturers', async () => {
    const { data } = await apiClient.get<SiapLecturer[]>(API.siap.lecturers);
    return data;
  }, CACHE.lecturers);
}

export async function getSiapAbsen(): Promise<SiapAbsenItem[]> {
  return getCached('siap:absen', async () => {
    const { data } = await apiClient.get<SiapAbsenItem[]>(API.siap.absen);
    return data;
  }, CACHE.absen);
}

export async function getSiapKehadiran(idJadwal: string): Promise<SiapKehadiran> {
  return getCached(`siap:kehadiran:${idJadwal}`, async () => {
    const { data } = await apiClient.get<SiapKehadiran>(API.siap.kehadiran(idJadwal));
    return data;
  }, CACHE.kehadiran);
}

/** Proxy token hasil scan QR absensi ke SIAP (anti-replay milik SIAP). */
export async function postKehadiranToken(token: string): Promise<KehadiranResult> {
  const { data } = await apiClient.post<KehadiranResult>(API.siap.markKehadiran, { token });
  return data;
}

export async function getDashboard(): Promise<DashboardPayload> {
  return getCached('dashboard', async () => {
    const { data } = await apiClient.get<DashboardPayload>(API.dashboard);
    return data;
  }, { freshTtl: 60_000, staleTtl: 60_000 });
}