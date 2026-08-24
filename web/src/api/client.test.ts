import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssignments, getCourses, capture } from './client';
import { emitReauthRequested } from '../lib/reauth';

vi.mock('../lib/reauth', () => ({
  emitReauthRequested: vi.fn(),
  emitTokenRefreshed: vi.fn(),
}));

// Mock axios so the instance's get/post/request are controllable and we don't
// hit the real backend. axios binds instance methods at construction time, so
// spying on `request` after creation does NOT intercept — we must mock the
// module itself.
const mockRequest = vi.fn();
const responseHandlers: { onFulfilled?: Function; onRejected?: Function } = {};
const mockInstance = {
  get: vi.fn((url: string, config?: any) => mockRequest({ method: 'get', url, ...config })),
  post: vi.fn((url: string, data?: any, config?: any) => mockRequest({ method: 'post', url, data, ...config })),
  interceptors: {
    request: {
      use: vi.fn((onFulfilled?: Function) => {
        // capture request interceptor for later assertions if needed
        mockInstance.requestHandler = onFulfilled;
      }),
    },
    response: {
      use: vi.fn((onFulfilled?: Function, onRejected?: Function) => {
        responseHandlers.onFulfilled = onFulfilled;
        responseHandlers.onRejected = onRejected;
      }),
    },
  },
  request: mockRequest,
  requestHandler: undefined as Function | undefined,
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockInstance),
  },
}));

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequest.mockReset();
    // Re-import the module fresh so it picks up the mocked axios create.
    vi.resetModules();
  });

  it('getAssignments fetches /api/kulon/assignments', async () => {
    mockRequest.mockResolvedValue({
      data: [{ id: 1, name: 'T', module: 'assign', eventType: 'due', duedate: 0, overdue: false, course: 'C', courseId: 1 }],
    });
    const { getAssignments } = await import('./client');
    const result = await getAssignments();
    expect(mockRequest).toHaveBeenCalled();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/kulon/assignments');
    expect(result).toHaveLength(1);
  });

  it('capture posts to /api/auth/sso/capture', async () => {
    mockRequest.mockResolvedValue({
      data: { accessToken: 't', capturedAt: 0, hasSso: true, hasMicrosoft: false, hasKulon: true },
    });
    const { capture } = await import('./client');
    await capture();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('post');
    expect(call.url).toBe('/api/auth/sso/capture');
  });

  it('getCourses fetches /api/kulon/courses', async () => {
    mockRequest.mockResolvedValue({ data: [] });
    const { getCourses } = await import('./client');
    await getCourses();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/kulon/courses');
  });

  it('Kulon 401 does NOT clear token or redirect (view handles re-login)', async () => {
    localStorage.setItem('sso_token', 'keep-me');
    await vi.resetModules();
    const { apiClient } = await import('./client');
    const onRejected = responseHandlers.onRejected!;
    const error = {
      response: { status: 401, data: { message: 'Session Kulon expired' } },
      config: { url: '/api/kulon/assignments' },
    };
    await expect(onRejected(error)).rejects.toMatchObject(error);
    expect(localStorage.getItem('sso_token')).toBe('keep-me');
  });

  it('SIAP 401 does NOT clear token or redirect (back-end session stale, JWT valid)', async () => {
    localStorage.setItem('sso_token', 'keep-me');
    await vi.resetModules();
    const { apiClient } = await import('./client');
    const onRejected = responseHandlers.onRejected!;
    const error = {
      response: { status: 401, data: { message: 'SIAP session expired' } },
      config: { url: '/api/siap/profile' },
    };
    await expect(onRejected(error)).rejects.toMatchObject(error);
    expect(localStorage.getItem('sso_token')).toBe('keep-me');
  });

  it('auth 401 with a dead refresh session clears token and requests re-auth (no hard redirect)', async () => {
    localStorage.setItem('sso_token', 'drop-me');
    (emitReauthRequested as any).mockClear();
    await vi.resetModules();
    // Silently attempt refresh first; it fails with a genuine 401 (dead session).
    mockRequest.mockRejectedValueOnce({ response: { status: 401, data: { code: 'SESSION_DEAD' } } });
    const { apiClient } = await import('./client');
    const onRejected = responseHandlers.onRejected!;
    const error = { response: { status: 401 }, config: { url: '/api/auth/me' } };
    await expect(onRejected(error)).rejects.toMatchObject(error);
    expect(localStorage.getItem('sso_token')).toBeNull();
    expect(emitReauthRequested).toHaveBeenCalledTimes(1);
  });

  it('getSiapProfile fetches /api/siap/profile', async () => {
    mockRequest.mockResolvedValue({
      data: { nama: 'Budi', nim: '2600000001', prodi: 'Informatika', fakultas: 'Fakultas Sains', angkatan: '2020', status: 'aktif' },
    });
    const { getSiapProfile } = await import('./client');
    const result = await getSiapProfile();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/siap/profile');
    expect(result.nama).toBe('Budi');
  });

  it('getSiapIrs fetches /api/siap/irs', async () => {
    mockRequest.mockResolvedValue({ data: { semester: '2025/2026 Genap', totalSks: 20, mataKuliah: [] } });
    const { getSiapIrs } = await import('./client');
    const result = await getSiapIrs();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/siap/irs');
    expect(result.totalSks).toBe(20);
  });

  it('getSiapKhs fetches /api/siap/khs', async () => {
    mockRequest.mockResolvedValue({ data: { ipk: 3.5, semesters: [] } });
    const { getSiapKhs } = await import('./client');
    const result = await getSiapKhs();
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/siap/khs');
    expect(result.ipk).toBe(3.5);
  });

  it('getAssignmentDetail fetches detail with id and cmid', async () => {
    mockRequest.mockResolvedValue({
      data: {
        assignmentId: 42,
        name: 'Tugas',
        descriptionHtml: '<p>x</p>',
        files: [],
        submission: { status: 'not_submitted', grade: null, maxGrade: null },
        kulonUrl: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
      },
    });
    const { getAssignmentDetail } = await import('./client');
    const result = await getAssignmentDetail(42, 777);
    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe('get');
    expect(call.url).toBe('/api/kulon/assignments/42/detail');
    expect(call.params).toEqual({ cmid: 777 });
    expect(result.assignmentId).toBe(42);
  });

  describe('silent refresh', () => {
    beforeEach(() => {
      // emitReauthRequested is a module-level vi.mock shared across tests; reset
      // it so per-test "not.toHaveBeenCalled" assertions are isolated.
      (emitReauthRequested as any).mockClear();
    });

    it('auth-401: refresh ok -> retries GET once with the new token', async () => {
      const newToken = 'new-jwt';
      // call (1) refresh success; call (2) retried GET success
      mockRequest
        .mockResolvedValueOnce({ data: { accessToken: newToken } })
        .mockResolvedValueOnce({ data: { id: 1 } });
      localStorage.setItem('sso_token', 'old-jwt');

      const err = {
        response: { status: 401, data: { code: 'INVALID_TOKEN' } },
        config: { method: 'get', url: '/api/auth/me' },
      };
      const result = await responseHandlers.onRejected!(err);
      expect(result.data).toEqual({ id: 1 });
      expect(localStorage.getItem('sso_token')).toBe(newToken);
    });

    it('auth-401: refresh 401 -> clears token and emits reauth', async () => {
      // call (1) refresh fails with 401 (SESSION_DEAD) — axios rejects
      mockRequest.mockRejectedValueOnce({
        response: { status: 401, data: { code: 'SESSION_DEAD' } },
      });
      localStorage.setItem('sso_token', 'old-jwt');

      const err = {
        response: { status: 401, data: { code: 'INVALID_TOKEN' } },
        config: { method: 'get', url: '/api/auth/me' },
      };
      await expect(responseHandlers.onRejected!(err)).rejects.toBeTruthy();
      expect(localStorage.getItem('sso_token')).toBeNull();
      expect(emitReauthRequested).toHaveBeenCalled();
    });

    it('auth-401: refresh network/5xx -> keeps token, propagates, no reauth', async () => {
      // call (1) refresh fails with a network error (no response.status)
      mockRequest.mockRejectedValueOnce(new Error('network down'));
      localStorage.setItem('sso_token', 'old-jwt');

      const err = {
        response: { status: 401, data: { code: 'INVALID_TOKEN' } },
        config: { method: 'get', url: '/api/auth/me' },
      };
      await expect(responseHandlers.onRejected!(err)).rejects.toBeTruthy();
      expect(localStorage.getItem('sso_token')).toBe('old-jwt');
      expect(emitReauthRequested).not.toHaveBeenCalled();
    });

    it('non-GET auth-401: refresh ok but does NOT retry (avoids double-POST)', async () => {
      // call (1) refresh success; but method is POST so no retry
      mockRequest.mockResolvedValueOnce({ data: { accessToken: 'new-jwt' } });
      localStorage.setItem('sso_token', 'old-jwt');

      // Non-service endpoint so the refresh path (not the service-401 short-circuit)
      // is exercised; the point is that a POST is refreshed but never re-sent.
      const err = {
        response: { status: 401, data: { code: 'INVALID_TOKEN' } },
        config: { method: 'post', url: '/api/auth/sso/capture' },
      };
      await expect(responseHandlers.onRejected!(err)).rejects.toBeTruthy();
      // only the refresh POST happened; no retry
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('concurrent auth-401s share ONE refresh POST (single-flight)', async () => {
      // call (1) shared refresh success; calls (2)+(3) the two retried GETs.
      mockRequest
        .mockResolvedValueOnce({ data: { accessToken: 'new-jwt' } })
        .mockResolvedValue({ data: { id: 1 } });
      localStorage.setItem('sso_token', 'old-jwt');

      const err = (url: string) => ({
        response: { status: 401, data: { code: 'INVALID_TOKEN' } },
        config: { method: 'get', url },
      });
      const { apiClient } = await import('./client');
      const onRejected = responseHandlers.onRejected!;
      await Promise.all([
        onRejected(err('/api/auth/me')),
        onRejected(err('/api/auth/me')),
      ]);
      // Without single-flight this would be 4: one refresh PER 401 + retries.
      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(mockRequest.mock.calls[0][0].url).toBe('/api/auth/refresh');
    });

    it('anti-loop: a 401 on /api/auth/refresh is terminal (never re-refreshed)', async () => {
      // The refresh endpoint's own response passes through the SAME interceptor.
      // If the refresh route 401s, it must reject and NOT trigger another refresh.
      mockRequest.mockRejectedValueOnce({
        response: { status: 401, data: { code: 'SESSION_DEAD' } },
      });
      localStorage.setItem('sso_token', 'old-jwt');

      const err = {
        response: { status: 401, data: { code: 'SESSION_DEAD' } },
        config: { method: 'get', url: '/api/auth/refresh' },
      };
      await expect(responseHandlers.onRejected!(err)).rejects.toBeTruthy();
      expect(mockRequest).toHaveBeenCalledTimes(0); // no refresh POST, no retry
      expect(localStorage.getItem('sso_token')).toBe('old-jwt');
    });
  });
});