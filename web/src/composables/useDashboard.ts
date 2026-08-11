import { onMounted, ref } from 'vue';
import {
  getCourses,
  getAllAssignments,
  getSiapProfile,
  getSiapIrs,
  getSiapKhs,
  getSiapJadwal,
} from '../api/client';
import type { Course, Assignment, SiapProfile, SiapKhs, SiapIrs, SiapJadwal } from '../types';

export interface SiapSource {
  profile: SiapProfile | null;
  khs: SiapKhs | null;
  irs: SiapIrs | null;
  jadwal: SiapJadwal[];
}

export interface KulonSource {
  courses: Course[];
  assignments: Assignment[];
}

export function useDashboard() {
  const siapLoading = ref(false);
  const siapError = ref<string | null>(null);
  const siap = ref<SiapSource>({ profile: null, khs: null, irs: null, jadwal: [] });

  const kulonLoading = ref(false);
  const kulonError = ref<string | null>(null);
  const kulon = ref<KulonSource>({ courses: [], assignments: [] });

  async function loadSiap() {
    siapLoading.value = true;
    siapError.value = null;
    try {
      const [profile, khs, irs] = await Promise.all([getSiapProfile(), getSiapKhs(), getSiapIrs()]);
      siap.value = { profile, khs, irs, jadwal: [] };
    } catch (e: any) {
      siapError.value = e?.response?.data?.message ?? 'Gagal memuat data akademik (SIAP)';
      siap.value = { profile: null, khs: null, irs: null, jadwal: [] };
    } finally {
      siapLoading.value = false;
    }
    // Jadwal is non-critical: its failure must NOT blank the whole dashboard.
    try {
      siap.value.jadwal = await getSiapJadwal();
    } catch {
      siap.value.jadwal = [];
    }
  }

  async function loadKulon() {
    kulonLoading.value = true;
    kulonError.value = null;
    try {
      const [courses, assignments] = await Promise.all([getCourses(), getAllAssignments()]);
      kulon.value = { courses, assignments };
    } catch (e: any) {
      kulonError.value = e?.response?.data?.message ?? 'Gagal memuat data Kulon';
      kulon.value = { courses: [], assignments: [] };
    } finally {
      kulonLoading.value = false;
    }
  }

  async function load(): Promise<void> {
    await Promise.all([loadSiap(), loadKulon()]);
  }

  onMounted(load);

  return { siapLoading, siapError, siap, kulonLoading, kulonError, kulon, load };
}
