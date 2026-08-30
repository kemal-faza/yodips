import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { clearCache } from '../api/cache';

// The mocked client re-exports getDashboard through the REAL cache layer —
// mirroring web/src/api/client.ts. A bare vi.fn() would bypass the cache,
// making cache-reuse tests meaningless (Phase-3 deviation (e)).
const { dashboardFetch } = vi.hoisted(() => ({ dashboardFetch: vi.fn() }));

vi.mock('../api/client', async () => {
  const { getCached } = await import('../api/cache');
  return {
    getDashboard: () =>
      getCached('dashboard', () => dashboardFetch(), { freshTtl: 60_000, staleTtl: 60_000 }),
  };
});

import { useDashboard } from './useDashboard';

const ok = (overrides: Record<string, unknown> = {}) => ({
  profile: { nama: 'A' },
  khs: null,
  irs: null,
  jadwal: [],
  courses: [],
  assignments: [],
  errors: {},
  ...overrides,
});

describe('useDashboard (single request)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearCache();
    vi.clearAllMocks();
    dashboardFetch.mockResolvedValue(ok());
  });

  it('maps payload slices to siap/kulon refs', async () => {
    dashboardFetch.mockResolvedValue(ok({
      profile: { nama: 'B' }, jadwal: [{ tanggal: '2026-08-30' }],
      courses: [{ id: 1 }], assignments: [{ id: 2 }],
    }));
    const d = useDashboard();
    await d.load();
    expect(d.siap.value.profile?.nama).toBe('B');
    expect(d.siap.value.jadwal).toHaveLength(1);
    expect(d.kulon.value.courses).toHaveLength(1);
    expect(d.kulon.value.assignments).toHaveLength(1);
    expect(d.siapError.value).toBeNull();
    expect(d.kulonError.value).toBeNull();
  });

  it('maps SIAP slice errors to siapError, keeping kulon populated', async () => {
    dashboardFetch.mockResolvedValue(ok({
      errors: { profile: { status: 401, message: 'Session SIAP expired. Silakan login ulang via SSO' } },
      courses: [{ id: 1 }],
    }));
    const d = useDashboard();
    await d.load();
    expect(d.siapError.value).toBe('Session SIAP expired. Silakan login ulang via SSO');
    expect(d.kulon.value.courses).toHaveLength(1);
    expect(d.kulonError.value).toBeNull();
  });

  it('maps Kulon slice errors to kulonError', async () => {
    dashboardFetch.mockResolvedValue(ok({
      errors: { assignments: { status: 401, message: 'Session Kulon expired. Silakan login ulang via SSO' } },
    }));
    const d = useDashboard();
    await d.load();
    expect(d.kulonError.value).toBe('Session Kulon expired. Silakan login ulang via SSO');
    expect(d.siapError.value).toBeNull();
  });

  it('does NOT raise siapError when only jadwal fails (silent, parity with today)', async () => {
    dashboardFetch.mockResolvedValue(ok({ errors: { jadwal: { status: 502, message: 'SIAP gangguan' } } }));
    const d = useDashboard();
    await d.load();
    expect(d.siapError.value).toBeNull();
    expect(d.siap.value.jadwal).toEqual([]);
  });

  it('sets both error banners on a network-level rejection', async () => {
    dashboardFetch.mockRejectedValue({ response: { data: { message: 'Network down' } } });
    const d = useDashboard();
    await d.load();
    expect(d.siapError.value).toBe('Network down');
    expect(d.kulonError.value).toBe('Network down');
  });

  it('does not call getSiapJadwal anymore (single request)', async () => {
    const d = useDashboard();
    await d.load();
    expect(dashboardFetch).toHaveBeenCalledTimes(1);
  });
});
