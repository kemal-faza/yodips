import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { clearCache } from '../api/cache';

// Network-level fetchers (what the real client would send over axios). The
// mocked client re-exports them through the REAL cache layer (getCached),
// mirroring how web/src/api/client.ts routes every getter through the cache.
// A bare vi.fn() client would bypass the cache, making cache-reuse tests
// meaningless.
const { getCourses, getAllAssignments, profileFetch, khsFetch, irsFetch, jadwalFetch } = vi.hoisted(() => ({
  getCourses: vi.fn(),
  getAllAssignments: vi.fn(),
  profileFetch: vi.fn(),
  khsFetch: vi.fn(),
  irsFetch: vi.fn(),
  jadwalFetch: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const { getCached } = await import('../api/cache');
  // Keys + TTLs match web/src/api/client.ts (5m fresh / 30m stale).
  const fresh = { freshTtl: 5 * 60_000, staleTtl: 30 * 60_000 };
  return {
    getCourses,
    getAllAssignments,
    getSiapProfile: () => getCached('siap:profile', () => profileFetch(), fresh),
    getSiapKhs: () => getCached('siap:khs', () => khsFetch(), fresh),
    getSiapIrs: () => getCached('siap:irs', () => irsFetch(), fresh),
    getSiapJadwal: () => getCached('siap:jadwal', () => jadwalFetch(), fresh),
  };
});

import { useDashboard } from './useDashboard';

describe('useDashboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearCache();
    vi.clearAllMocks();
    getCourses.mockResolvedValue([]);
    getAllAssignments.mockResolvedValue([]);
    profileFetch.mockResolvedValue({ nama: 'A' } as never);
    irsFetch.mockResolvedValue(null as never);
    khsFetch.mockResolvedValue(null as never);
    jadwalFetch.mockResolvedValue([]);
  });

  it('loads and splits data by source (original behavior retained)', async () => {
    const d = useDashboard();
    await d.load();
    expect(d.siap.value.profile).toEqual({ nama: 'A' });
    expect(d.kulon.value.assignments).toEqual([]);
    expect(d.siapLoading.value).toBe(false);
    expect(d.kulonLoading.value).toBe(false);
  });

  it('reuses cached data instead of re-fetching when fresh', async () => {
    const d = useDashboard();
    // first load warms the cache
    await d.load();
    profileFetch.mockClear();
    // second load: fresh cache → no network
    await d.load();
    expect(profileFetch).not.toHaveBeenCalled();
  });
});
