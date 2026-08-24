<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  getSiapAbsen,
  getSiapIrs,
  getSiapJadwal,
  getSiapLecturers,
  getSiapProfile,
} from '../../api/client';
import type { SiapAbsenItem, SiapIrs, SiapJadwal, SiapProfile } from '../../types';
import { absenByNamaMap, irsJadwal, jadwalByNamaMap, semesterOrdinal } from '../../utils/irs-mobile';
import ScheduleCardMobile from '../components/ScheduleCardMobile.vue';

const loading = ref(true);
const error = ref<string | null>(null);
const profile = ref<SiapProfile | null>(null);
const irs = ref<SiapIrs | null>(null);
const lecturerByKode = ref(new Map<string, string>());
const jadwalMap = ref(new Map<string, SiapJadwal>());
const absenMap = ref(new Map<string, SiapAbsenItem>());

const ordinal = computed(() =>
  profile.value ? semesterOrdinal(profile.value.angkatan ?? '', profile.value.semesterBerjalan) : null,
);

const cards = computed(() =>
  (irs.value?.mataKuliah ?? []).map((mk) => {
    const vm = irsJadwal(mk, jadwalMap.value);
    return {
      key: mk.kode + '|' + mk.nama,
      vm,
      // Dosen di-join by kode MIK hasil join jadwal (kode kartu yang tampil),
      // fallback ke dosen baris IRS bila jadwal/dosen tidak ketemu.
      lecturer: lecturerByKode.value.get(vm.kode) ?? mk.dosen ?? null,
      absen: absenMap.value.get(mk.nama.trim().toLowerCase()) ?? null,
    };
  }),
);

onMounted(async () => {
  try {
    const [p, l, j, a, i] = await Promise.all([
      getSiapProfile(), getSiapLecturers(), getSiapJadwal(), getSiapAbsen(), getSiapIrs(),
    ]);
    profile.value = p;
    lecturerByKode.value = new Map(l.filter((x) => x.dosen).map((x) => [x.kode, x.dosen]));
    jadwalMap.value = jadwalByNamaMap(j);
    absenMap.value = absenByNamaMap(a);
    irs.value = i;
  } catch {
    error.value = 'Gagal memuat IRS.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">Memuat IRS…</div>
    <div v-else-if="error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">{{ error }}</div>

    <template v-else>
      <!-- Semester -->
      <section class="rounded-xl border border-border bg-secondary/30 p-4" data-test="irs-semester">
        <p class="text-sm font-bold text-foreground">{{ ordinal !== null ? `Semester ${ordinal}` : 'Semester' }}</p>
        <p v-if="profile?.semesterBerjalan" class="text-xs text-muted-foreground">{{ profile.semesterBerjalan }}</p>
      </section>

      <!-- Ringkasan -->
      <section
        class="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
        data-test="irs-summary"
      >
        <span>{{ irs?.mataKuliah.length ?? 0 }} mata kuliah</span>
        <span class="font-semibold">Total SKS {{ irs?.totalSks ?? 0 }}</span>
      </section>

      <ScheduleCardMobile
        v-for="c in cards"
        :key="c.key"
        :jadwal="c.vm"
        :lecturer="c.lecturer"
        :absen="c.absen"
      />
    </template>
  </div>
</template>
