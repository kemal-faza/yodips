import axios, { AxiosInstance } from 'axios';
import type { Assignment, CaptureResult, Course, User } from '../types';

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
    if (error?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
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