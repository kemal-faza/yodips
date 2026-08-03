import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssignments, getCourses, capture } from './client';

// Mock axios so the instance's get/post/request are controllable and we don't
// hit the real backend. axios binds instance methods at construction time, so
// spying on `request` after creation does NOT intercept — we must mock the
// module itself.
const mockRequest = vi.fn();
const mockInstance = {
  get: vi.fn((url: string, config?: any) => mockRequest({ method: 'get', url, ...config })),
  post: vi.fn((url: string, data?: any, config?: any) => mockRequest({ method: 'post', url, data, ...config })),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  request: mockRequest,
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
});