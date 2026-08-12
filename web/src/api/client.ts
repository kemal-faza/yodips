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
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? '';
    if (status === 401) {
      // A backend session can report 401 even when the JWT is still valid
      // (Kulon/SIAP cookies expired server-side). For those routes keep the
      // token — the view shows a re-login card. Only a genuine auth-token 401
      // (invalid/expired JWT) is a full logout + redirect.
      const isServiceSession = url.startsWith('/api/kulon') || url.startsWith('/api/siap');
      if (!isServiceSession) {
        // Auth-token 401 (invalid/expired JWT): full logout + redirect.
        localStorage.removeItem(TOKEN_KEY);
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
      // Service 401 (Kulon/SIAP back-end session expired); JWT is still valid.
      // We deliberately keep the token so the user can re-capture without
      // losing their auth state.
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