import { onMounted, ref } from 'vue';
import { useKulonStore } from '../stores/kulon';
import { getSiapProfile, getSiapIrs, getSiapKhs, getSiapJadwal } from '../api/client';
import type { SiapProfile, SiapKhs, SiapIrs, SiapJadwal } from '../types';

export interface SiapSource { profile: SiapProfile | null; khs: SiapKhs | null; irs: SiapIrs | null; jadwal: SiapJadwal[]; }
export interface KulonSource { courses: ReturnType<typeof useKulonStore>['courses']; assignments: ReturnType<typeof useKulonStore>['assignments']; }

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
      siap.value = { profile, khs, irs, jadwal: siap.value.jadwal };
    } catch (e: any) {
      siapError.value = e?.response?.data?.message ?? 'Gagal memuat data akademik (SIAP)';
    } finally {
      siapLoading.value = false;
    }
    try {
      siap.value = { ...siap.value, jadwal: await getSiapJadwal() };
    } catch { /* keep existing jadwal */ }
  }

  async function loadKulon() {
    kulonLoading.value = true;
    kulonError.value = null;
    const store = useKulonStore();
    try {
      await Promise.all([store.ensureCourses(), store.ensureAssignments()]);
      kulon.value = { courses: store.courses, assignments: store.assignments };
    } catch (e: any) {
      kulonError.value = e?.response?.data?.message ?? 'Gagal memuat data Kulon';
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
