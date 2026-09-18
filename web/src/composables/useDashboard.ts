import { computed, onMounted, reactive, ref } from 'vue';
import {
  getAllAssignments,
  getCourses,
  getSiapIrs,
  getSiapJadwal,
  getSiapKhs,
  getSiapProfile,
  invalidateDashboardDynamicSlices,
} from '../api/client';
import { isCacheStaleError } from '../api/cache';
import type { Assignment, Course, SiapIrs, SiapJadwal, SiapKhs, SiapProfile } from '../types';

export interface SiapSource { profile: SiapProfile | null; khs: SiapKhs | null; irs: SiapIrs | null; jadwal: SiapJadwal[]; }
export interface KulonSource { courses: Course[]; assignments: Assignment[]; }

type SliceName = 'profile' | 'khs' | 'irs' | 'jadwal' | 'courses' | 'assignments';

const ALL_SLICES: readonly SliceName[] = [
  'profile', 'khs', 'irs', 'jadwal', 'courses', 'assignments',
];
const DYNAMIC_SLICES: readonly SliceName[] = ['irs', 'jadwal', 'courses', 'assignments'];

function messageFor(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: { message?: unknown } };
    message?: unknown;
  } | null;
  if (typeof candidate?.response?.data?.message === 'string') return candidate.response.data.message;
  if (typeof candidate?.message === 'string') return candidate.message;
  return fallback;
}

export function useDashboard() {
  const siap = ref<SiapSource>({ profile: null, khs: null, irs: null, jadwal: [] });
  const kulon = ref<KulonSource>({ courses: [], assignments: [] });

  // Keep the slow profile/KHS requests separate from the dynamic dashboard
  // requests. This lets the schedule/stats and refresh control proceed while
  // a slow profile endpoint is still settling.
  const pending = reactive({ profile: 0, khs: 0, siap: 0, kulon: 0 });
  const sliceErrors = reactive<Record<SliceName, string | null>>({
    profile: null, khs: null, irs: null, jadwal: null, courses: null, assignments: null,
  });

  const profileLoading = computed(() => pending.profile > 0);
  const khsLoading = computed(() => pending.khs > 0);
  const siapLoading = computed(() => pending.siap > 0);
  const kulonLoading = computed(() => pending.kulon > 0);
  // Jadwal-only failures remain silent, matching the previous behavior.
  const siapError = computed(() => sliceErrors.profile ?? sliceErrors.khs ?? sliceErrors.irs ?? null);
  const kulonError = computed(() => sliceErrors.courses ?? sliceErrors.assignments ?? null);

  async function runSlice<T>(
    source: 'profile' | 'khs' | 'siap' | 'kulon',
    slice: SliceName,
    fetcher: () => Promise<T>,
    commit: (value: T) => void,
    fallback: string,
  ): Promise<void> {
    pending[source] += 1;
    try {
      const value = await fetcher();
      // Nullish responses are partial/invalid for dashboard purposes. Never
      // erase an already-rendered value with one.
      if (value != null) commit(value);
    } catch (error) {
      // A logout/session wipe crossing this request is a typed cancellation,
      // not a user-facing upstream error.
      if (!isCacheStaleError(error) && slice !== 'jadwal') {
        sliceErrors[slice] = messageFor(error, fallback);
      }
    } finally {
      pending[source] -= 1;
    }
  }

  function resetErrors(slices: readonly SliceName[]): void {
    for (const slice of slices) sliceErrors[slice] = null;
  }

  function loadSlices(slices: readonly SliceName[]): Promise<void> {
    resetErrors(slices);
    const requests: Promise<void>[] = [];

    if (slices.includes('profile')) requests.push(runSlice('profile', 'profile', getSiapProfile, (value) => { siap.value.profile = value; }, 'Gagal memuat profil SIAP'));
    if (slices.includes('khs')) requests.push(runSlice('khs', 'khs', getSiapKhs, (value) => { siap.value.khs = value; }, 'Gagal memuat KHS SIAP'));
    if (slices.includes('irs')) requests.push(runSlice('siap', 'irs', getSiapIrs, (value) => { siap.value.irs = value; }, 'Gagal memuat IRS SIAP'));
    if (slices.includes('jadwal')) requests.push(runSlice('siap', 'jadwal', getSiapJadwal, (value) => { siap.value.jadwal = value; }, 'Gagal memuat jadwal SIAP'));
    if (slices.includes('courses')) requests.push(runSlice('kulon', 'courses', getCourses, (value) => { kulon.value.courses = value; }, 'Gagal memuat mata kuliah Kulon'));
    if (slices.includes('assignments')) requests.push(runSlice('kulon', 'assignments', getAllAssignments, (value) => { kulon.value.assignments = value; }, 'Gagal memuat tugas Kulon'));

    // Each runSlice handles its own failure, so one upstream cannot block the
    // other sections from rendering progressively.
    return Promise.all(requests).then(() => undefined);
  }

  /** Normal navigation load: all six slices start in the same turn. */
  function load(): Promise<void> {
    return loadSlices(ALL_SLICES);
  }

  /** Dashboard refresh: force only frequently-changing slices. */
  function refresh(): Promise<void> {
    invalidateDashboardDynamicSlices();
    return loadSlices(DYNAMIC_SLICES);
  }

  onMounted(() => { void load(); });

  return { profileLoading, khsLoading, siapLoading, siapError, siap, kulonLoading, kulonError, kulon, load, refresh };
}
