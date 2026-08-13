import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
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

import { useDashboard, __resetDashboardCache } from './useDashboard';

describe('useDashboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    __resetDashboardCache();
    vi.clearAllMocks();
    mockApi.getCourses.mockResolvedValue([]);
    mockApi.getAllAssignments.mockResolvedValue([]);
    mockApi.getSiapProfile.mockResolvedValue({ nama: 'A' } as never);
    mockApi.getSiapIrs.mockResolvedValue(null as never);
    mockApi.getSiapKhs.mockResolvedValue(null as never);
    mockApi.getSiapJadwal.mockResolvedValue([]);
  });

  it('loads and splits data by source (original behavior retained)', async () => {
    const d = useDashboard();
    await d.load();
    expect(d.siap.value.profile).toEqual({ nama: 'A' });
    expect(d.kulon.value.assignments).toEqual([]);
    expect(d.siapLoading.value).toBe(false);
    expect(d.kulonLoading.value).toBe(false);
  });

  it('serves stale cached data instantly on revisit, then refreshes in background', async () => {
    mockApi.getSiapProfile.mockResolvedValue({ nama: 'A' } as never);
    const d1 = useDashboard();
    await d1.load();
    expect(d1.siap.value.profile).toEqual({ nama: 'A' });

    mockApi.getSiapProfile.mockResolvedValue({ nama: 'B' } as never);
    const d2 = useDashboard();
    expect(d2.siap.value.profile).toEqual({ nama: 'A' });

    await d2.load();
    expect(d2.siap.value.profile).toEqual({ nama: 'B' });
  });
});