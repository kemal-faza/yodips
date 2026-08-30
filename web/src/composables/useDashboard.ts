import { onMounted, ref } from 'vue';
import { getDashboard } from '../api/client';
import type { SiapProfile, SiapKhs, SiapIrs, SiapJadwal } from '../types';
import type { Course, Assignment } from '../types';

export interface SiapSource { profile: SiapProfile | null; khs: SiapKhs | null; irs: SiapIrs | null; jadwal: SiapJadwal[]; }
export interface KulonSource { courses: Course[]; assignments: Assignment[]; }

export function useDashboard() {
  const siapLoading = ref(false);
  const siapError = ref<string | null>(null);
  const siap = ref<SiapSource>({ profile: null, khs: null, irs: null, jadwal: [] });
  const kulonLoading = ref(false);
  const kulonError = ref<string | null>(null);
  const kulon = ref<KulonSource>({ courses: [], assignments: [] });

  async function load(): Promise<void> {
    siapLoading.value = true;
    kulonLoading.value = true;
    siapError.value = null;
    kulonError.value = null;
    try {
      const d = await getDashboard();
      const errs = d.errors ?? {}; // defensive: backend pins errors={} but never crash on missing
      siap.value = { profile: d.profile, khs: d.khs, irs: d.irs, jadwal: d.jadwal };
      kulon.value = { courses: d.courses ?? [], assignments: d.assignments ?? [] };
      // jadwal intentionally excluded: a jadwal-only failure is silent (parity
      // with the pre-aggregation loadSiap which caught getSiapJadwal errors).
      if (errs.profile || errs.khs || errs.irs)
        siapError.value = errs.profile?.message ?? errs.khs?.message ?? errs.irs?.message ?? null;
      if (errs.courses || errs.assignments)
        kulonError.value = errs.courses?.message ?? errs.assignments?.message ?? null;
    } catch (e: any) {
      siapError.value = e?.response?.data?.message ?? 'Gagal memuat data akademik (SIAP)';
      kulonError.value = e?.response?.data?.message ?? 'Gagal memuat data Kulon';
    } finally {
      siapLoading.value = false;
      kulonLoading.value = false;
    }
  }

  onMounted(load);

  return { siapLoading, siapError, siap, kulonLoading, kulonError, kulon, load };
}
