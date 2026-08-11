import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import * as api from '../api/client';

vi.mock('../api/client', () => ({
  getCourses: vi.fn(),
  getAllAssignments: vi.fn(),
  getSiapProfile: vi.fn(),
  getSiapIrs: vi.fn(),
  getSiapKhs: vi.fn(),
  getSiapJadwal: vi.fn(),
}));

const mockApi = api as unknown as {
  getCourses: ReturnType<typeof vi.fn>;
  getAllAssignments: ReturnType<typeof vi.fn>;
  getSiapProfile: ReturnType<typeof vi.fn>;
  getSiapIrs: ReturnType<typeof vi.fn>;
  getSiapKhs: ReturnType<typeof vi.fn>;
  getSiapJadwal: ReturnType<typeof vi.fn>;
};

import { useDashboard } from './useDashboard';

describe('useDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getCourses.mockResolvedValue([]);
    mockApi.getAllAssignments.mockResolvedValue([]);
    mockApi.getSiapProfile.mockResolvedValue({ nama: 'A' } as never);
    mockApi.getSiapIrs.mockResolvedValue(null as never);
    mockApi.getSiapKhs.mockResolvedValue(null as never);
    mockApi.getSiapJadwal.mockResolvedValue([]);
  });

  it('loads and splits data by source', async () => {
    const d = useDashboard();
    await d.load();
    expect(d.siap.value.profile).toEqual({ nama: 'A' });
    expect(d.kulon.value.assignments).toEqual([]);
    expect(d.siapLoading.value).toBe(false);
    expect(d.kulonLoading.value).toBe(false);
  });

  it('sets per-source error without breaking the other source', async () => {
    mockApi.getSiapProfile.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'SIAP down' } } }));
    const d = useDashboard();
    await d.load();
    expect(d.siapError.value).toBe('SIAP down');
    expect(d.siap.value.profile).toBeNull();
    expect(d.kulonError.value).toBeNull();
    expect(d.kulon.value.assignments).toEqual([]);
  });
});