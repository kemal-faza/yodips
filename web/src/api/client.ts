import axios, { AxiosInstance } from 'axios';
import type { Assignment, AssignmentDetail, CaptureResult, Course, User } from '../types';

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
      const isKulon = url.startsWith('/api/kulon');
      if (!isKulon) {
        // Auth-token 401 (invalid/expired JWT): full logout + redirect.
        localStorage.removeItem(TOKEN_KEY);
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
      // Kulon 401 = back-end session expired; the view shows a re-login card.
      // We deliberately keep the token (the JWT is still valid) so the user
      // can re-capture without losing their auth state.
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

export async function getCourses(): Promise<Course[]> {
  const { data } = await apiClient.get<Course[]>('/api/kulon/courses');
  return data;
}

export async function getAssignmentDetail(assignmentId: number, cmid: number): Promise<AssignmentDetail> {
  const { data } = await apiClient.get<AssignmentDetail>(
    `/api/kulon/assignments/${assignmentId}/detail`,
    { params: { cmid } },
  );
  return data;
}