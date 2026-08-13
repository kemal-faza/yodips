import { onMounted, ref } from 'vue';
import { useKulonStore } from '../stores/kulon';
import { getSiapProfile, getSiapIrs, getSiapKhs, getSiapJadwal } from '../api/client';
import type { Course, Assignment, SiapProfile, SiapKhs, SiapIrs, SiapJadwal } from '../types';

let lastSiap: SiapSource | null = null;
let lastKulon: KulonSource | null = null;

export function __resetDashboardCache() {
  lastSiap = null;
  lastKulon = null;
}

export interface SiapSource { profile: SiapProfile | null; khs: SiapKhs | null; irs: SiapIrs | null; jadwal: SiapJadwal[]; }
export interface KulonSource { courses: Course[]; assignments: Assignment[]; }

export function useDashboard() {
  const siapLoading = ref(false);
  const siapError = ref<string | null>(null);
  const siap = ref<SiapSource>(lastSiap ?? { profile: null, khs: null, irs: null, jadwal: [] });
  const kulonLoading = ref(false);
  const kulonError = ref<string | null>(null);
  const kulon = ref<KulonSource>(lastKulon ?? { courses: [], assignments: [] });

  async function loadSiap() {
    siapLoading.value = true;
    siapError.value = null;
    try {
      const [profile, khs, irs] = await Promise.all([getSiapProfile(), getSiapKhs(), getSiapIrs()]);
      const next: SiapSource = { profile, khs, irs, jadwal: siap.value.jadwal };
      siap.value = next;
      lastSiap = next;
    } catch (e: any) {
      siapError.value = e?.response?.data?.message ?? 'Gagal memuat data akademik (SIAP)';
    } finally {
      siapLoading.value = false;
    }
    try {
      const jadwal = await getSiapJadwal();
      const next = { ...siap.value, jadwal };
      siap.value = next;
      lastSiap = next;
    } catch {
      /* keep existing jadwal */
    }
  }

  async function loadKulon() {
    kulonLoading.value = true;
    kulonError.value = null;
    const store = useKulonStore();
    try {
      await Promise.all([store.ensureCourses(), store.ensureAssignments()]);
      const next: KulonSource = { courses: store.courses, assignments: store.assignments };
      kulon.value = next;
      lastKulon = next;
    } catch (e: any) {
      kulonError.value = e?.response?.data?.message ?? 'Gagal memuat data Kulon';
    } finally {
      kulonLoading.value = false;
    }
  }

  async function load(): Promise<void> {
    await Promise.all([loadSiap(), loadKulon()]);
  }

  if (lastSiap || lastKulon) {
    if (lastSiap) siap.value = lastSiap;
    if (lastKulon) kulon.value = lastKulon;
    void load();
  } else {
    onMounted(load);
  }

  return { siapLoading, siapError, siap, kulonLoading, kulonError, kulon, load };
}