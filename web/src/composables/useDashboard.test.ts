import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { clearCache, invalidate } from '../api/cache';

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  khs: vi.fn(),
  irs: vi.fn(),
  jadwal: vi.fn(),
  courses: vi.fn(),
  dashboardCourses: vi.fn(),
  assignments: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const { getCached } = await import('../api/cache');
  const opts = { freshTtl: 60_000, staleTtl: 120_000 };
  return {
    getSiapProfile: () => getCached('siap:profile', mocks.profile, opts),
    getSiapKhs: () => getCached('siap:khs', mocks.khs, opts),
    getSiapIrs: () => getCached('siap:irs', mocks.irs, opts),
    getSiapJadwal: () => getCached('siap:jadwal', mocks.jadwal, opts),
    getCourses: () => getCached('kulon:courses', mocks.courses, opts),
    getDashboardCourses: () => getCached('kulon:courses:summary', mocks.dashboardCourses, opts),
    getAllAssignments: () => getCached('kulon:assignments', mocks.assignments, opts),
  };
});

import { useDashboard } from './useDashboard';

const profile = { nama: 'Anindita', nim: '1' };
const khs = { ipk: 3.7, semesters: [] };
const irs = { semester: '2026/2027', totalSks: 18, mataKuliah: [] };
const jadwal = [{ tanggal: '2026-09-18' }];
const courses = [{ id: 1, fullname: 'Course', timelineStatus: 'inprogress' }];
const assignments = [{ id: 2, name: 'Task' }];

describe('useDashboard (slice-aware)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearCache();
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue(profile);
    mocks.khs.mockResolvedValue(khs);
    mocks.irs.mockResolvedValue(irs);
    mocks.jadwal.mockResolvedValue(jadwal);
    mocks.courses.mockResolvedValue(courses);
    mocks.dashboardCourses.mockResolvedValue(courses);
    mocks.assignments.mockResolvedValue(assignments);
  });

  it('starts all six requests in parallel and commits fast slices progressively', async () => {
    let resolveProfile!: (value: typeof profile) => void;
    let resolveDashboardCourses!: (value: typeof courses) => void;
    mocks.profile.mockImplementation(() => new Promise((resolve) => { resolveProfile = resolve; }));
    mocks.dashboardCourses.mockImplementation(() => new Promise((resolve) => { resolveDashboardCourses = resolve; }));

    const d = useDashboard();
    const loading = d.load();
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.khs).toHaveBeenCalledTimes(1);
    expect(mocks.irs).toHaveBeenCalledTimes(1);
    expect(mocks.jadwal).toHaveBeenCalledTimes(1);
    expect(mocks.dashboardCourses).toHaveBeenCalledTimes(1);
    expect(mocks.assignments).toHaveBeenCalledTimes(1);
    expect(d.siapLoading.value).toBe(true);
    expect(d.profileLoading.value).toBe(true);
    expect(d.kulonLoading.value).toBe(true);

    resolveProfile(profile);
    await flushPromises();
    expect(d.siap.value.profile).toEqual(profile);
    expect(d.kulon.value.courses).toEqual([]);
    expect(d.siapLoading.value).toBe(false); // remaining SIAP slices have settled
    expect(d.profileLoading.value).toBe(false);
    expect(d.kulonLoading.value).toBe(true); // courses is still pending

    resolveDashboardCourses(courses);
    await loading;
    expect(d.kulon.value.courses).toEqual(courses);
    expect(d.kulonLoading.value).toBe(false);
  });

  it('keeps partial errors isolated and leaves jadwal failures silent', async () => {
    mocks.profile.mockRejectedValue({ response: { data: { message: 'SIAP down' } } });
    mocks.jadwal.mockRejectedValue(new Error('calendar down'));
    mocks.assignments.mockRejectedValue({ response: { data: { message: 'Kulon down' } } });

    const d = useDashboard();
    await d.load();
    expect(d.siapError.value).toBe('SIAP down');
    expect(d.kulonError.value).toBe('Kulon down');
    expect(d.siap.value.irs).toEqual(irs);
    expect(d.kulon.value.courses).toEqual(courses);
    expect(d.siap.value.jadwal).toEqual([]);
  });

  it('does not replace a valid value when a slice returns null', async () => {
    const d = useDashboard();
    await d.load();
    invalidate('siap:profile');
    mocks.profile.mockResolvedValue(null);
    await d.load();
    expect(d.siap.value.profile).toEqual(profile);
    // Null was not persisted, so a later route request fetches again.
    invalidate('siap:profile');
    await import('../api/cache').then(({ getCached }) =>
      getCached('siap:profile', mocks.profile, { freshTtl: 60_000, staleTtl: 120_000 }),
    );
    expect(mocks.profile).toHaveBeenCalledTimes(3);
  });

  it('prevents a logout-crossed response from updating dashboard refs', async () => {
    let resolveProfile!: (value: typeof profile) => void;
    mocks.profile.mockImplementation(() => new Promise((resolve) => { resolveProfile = resolve; }));
    const d = useDashboard();
    const pending = d.load();
    clearCache();
    resolveProfile({ nama: 'Old user', nim: 'old' });
    await pending;
    expect(d.siap.value.profile).toBeNull();
    expect(d.siapError.value).toBeNull();
  });

  it('reuses dashboard results on Profile and keeps public course cache separate', async () => {
    const d = useDashboard();
    await d.load();
    const client = await import('../api/client');
    await client.getSiapProfile();
    await client.getDashboardCourses();
    await client.getCourses();
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.dashboardCourses).toHaveBeenCalledTimes(1);
    expect(mocks.courses).toHaveBeenCalledTimes(1);
    expect(d.siap.value.profile).toEqual(profile);
  });
});
