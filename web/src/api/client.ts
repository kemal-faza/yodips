import axios, { AxiosInstance } from 'axios';
import type {
  Assignment,
  AssignmentDetail,
  CaptureResult,
  Course,
  KulonCourseContent,
  SiapIrs,
  SiapJadwal,
  SiapKhs,
  SiapNotifications,
  SiapProfile,
  User,
} from '../types';
import { emitReauthRequested, emitTokenRefreshed } from '../lib/reauth';

const TOKEN_KEY = 'sso_token';

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
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
      // A backend session can report 401 even when the JWT is still valid
      // (Kulon/SIAP cookies expired server-side). For those routes keep the
      // token — the view shows a re-login card. Only a genuine auth-token 401
      // (invalid/expired JWT) is a full logout + redirect.
      const isServiceSession = url.startsWith('/api/kulon') || url.startsWith('/api/siap');
      // The refresh endpoint's OWN 401 must be terminal — never re-refresh (loop).
      if (isServiceSession || url.startsWith('/api/auth/refresh')) {
        return Promise.reject(error);
      }
      // Auth-token 401: try silent refresh first. Only if that fails do we
      // clear the token and ask the app to re-auth.
      const alreadyRetried = (error.config as { _retried?: boolean } | undefined)?._retried;
      if (!alreadyRetried) {
        let newToken: string;
        try {
          newToken = await refreshToken();
        } catch (refreshErr) {
          const refreshStatus = (refreshErr as any)?.response?.status;
          if (refreshStatus === 401) {
            // Genuinely dead session (SESSION_DEAD / INVALID_TOKEN).
            localStorage.removeItem(TOKEN_KEY);
            emitReauthRequested();
          }
          // Network/5xx: keep the token; server down != dead session.
          return Promise.reject(error);
        }
        localStorage.setItem(TOKEN_KEY, newToken);
        emitTokenRefreshed(newToken); // keep auth store in sync
        // Only retry idempotent requests; a POST must not be re-sent.
        // The retry propagates as-is: a 401 here carries `_retried`, so a
        // re-entry into this interceptor goes straight to the re-login path.
        if (method === 'get' || method === 'head') {
          return apiClient.request({ ...error.config, _retried: true });
        }
        return Promise.reject(error);
      }
      localStorage.removeItem(TOKEN_KEY);
      emitReauthRequested();
    }
    return Promise.reject(error);
  },
);

export async function capture(): Promise<CaptureResult> {
  const { data } = await apiClient.post<CaptureResult>('/api/auth/sso/capture');
  return data;
}

export async function me(): Promise<User> {
  const { data } = await apiClient.get<User>('/api/auth/me');
  return data;
}

/** POST /api/auth/refresh with the current (possibly expired) JWT. Throws on failure. */
export async function refreshToken(): Promise<string> {
  const { data } = await apiClient.post<{ accessToken: string }>('/api/auth/refresh');
  return data.accessToken;
}

export async function getAssignments(): Promise<Assignment[]> {
  const { data } = await apiClient.get<Assignment[]>('/api/kulon/assignments');
  return data;
}

export async function getAllAssignments(): Promise<Assignment[]> {
  const { data } = await apiClient.get<Assignment[]>('/api/kulon/assignments/all');
  return data;
}

export async function getCourses(): Promise<Course[]> {
  const { data } = await apiClient.get<Course[]>('/api/kulon/courses');
  return data;
}

export async function getCourseContent(courseId: number): Promise<KulonCourseContent> {
  const { data } = await apiClient.get<KulonCourseContent>(`/api/kulon/courses/${courseId}/content`);
  return data;
}

export async function getAssignmentDetail(assignmentId: number, cmid: number): Promise<AssignmentDetail> {
  const { data } = await apiClient.get<AssignmentDetail>(
    `/api/kulon/assignments/${assignmentId}/detail`,
    { params: { cmid } },
  );
  return data;
}

export async function getSiapProfile(): Promise<SiapProfile> {
  const { data } = await apiClient.get<SiapProfile>('/api/siap/profile');
  return data;
}

export async function getSiapIrs(): Promise<SiapIrs> {
  const { data } = await apiClient.get<SiapIrs>('/api/siap/irs');
  return data;
}

export async function getSiapKhs(): Promise<SiapKhs> {
  const { data } = await apiClient.get<SiapKhs>('/api/siap/khs');
  return data;
}

export async function getSiapJadwal(): Promise<SiapJadwal[]> {
  const { data } = await apiClient.get<SiapJadwal[]>('/api/siap/jadwal');
  return data;
}

export async function getNotifications(): Promise<SiapNotifications> {
  const { data } = await apiClient.get<SiapNotifications>('/api/siap/notifications');
  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(`/api/siap/notifications/${id}/unread`);
}