<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getSiapProfile, getSiapIrs, getSiapKhs } from '../api/client';
import type { SiapProfile, SiapIrs, SiapKhs } from '../types';

const props = defineProps<{ hasSiap: boolean }>();

const SIAP_POLL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const profile = ref<SiapProfile | null>(null);
const irs = ref<SiapIrs | null>(null);
const khs = ref<SiapKhs | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function load() {
  if (inFlight) return;
  inFlight = true;
  error.value = null;
  loading.value = true;
  try {
    const [p, i, k] = await Promise.all([getSiapProfile(), getSiapIrs(), getSiapKhs()]);
    profile.value = p;
    irs.value = i;
    khs.value = k;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? 'Gagal memuat data akademik';
  } finally {
    loading.value = false;
    inFlight = false;
  }
}

function schedulePolling() {
  clearInterval(timer!);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, SIAP_POLL_MS);
}

onMounted(() => {
  if (props.hasSiap) {
    load();
    schedulePolling();
  }
});

onUnmounted(() => clearInterval(timer!));
</script>

<template>
  <div v-if="!hasSiap" class="p-6 text-center text-navy-light">
    Belum ada session SIAP — silakan login ulang via SSO.
  </div>

  <div v-else class="space-y-6">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wide text-navy-light">Akademik</span>
      <button
        class="rounded bg-gold px-3 py-1.5 text-sm font-medium text-navy transition hover:bg-gold/80"
        @click="load"
      >Segarkan</button>
    </div>

    <div v-if="loading" class="mt-4 space-y-3">
      <div v-for="i in 3" :key="i" class="h-20 animate-pulse rounded-card bg-white" />
    </div>

    <div v-else-if="error" class="rounded bg-danger/10 p-4 text-danger">{{ error }}</div>

    <template v-else>
      <section v-if="profile" class="rounded-2xl border border-navy/10 bg-white p-5">
        <h2 class="mb-2 text-lg font-bold text-navy">Profil & Status</h2>
        <p class="text-sm font-medium text-navy">{{ profile.nama }}</p>
        <p class="text-sm text-navy-light">NIM {{ profile.nim }} · {{ profile.prodi }}</p>
        <p class="text-sm text-navy-light">{{ profile.fakultas }}</p>
        <p class="mt-1 inline-block rounded bg-gold/15 px-2 py-0.5 text-xs font-semibold text-navy">
          {{ profile.status }}
        </p>
        <p v-if="profile.ipk != null" class="mt-2 text-sm font-semibold text-navy">
          IPK: {{ profile.ipk }}
        </p>
      </section>

      <section v-if="irs" class="rounded-2xl border border-navy/10 bg-white p-5">
        <h2 class="mb-2 text-lg font-bold text-navy">IRS — {{ irs.semester }}</h2>
        <p class="mb-2 text-sm text-navy-light">Total SKS: {{ irs.totalSks }}</p>
        <ul class="space-y-1 text-sm">
          <li v-for="mk in irs.mataKuliah" :key="mk.kode" class="flex justify-between gap-2">
            <span>{{ mk.kode }} — {{ mk.nama }}</span>
            <span class="shrink-0 text-navy-light">{{ mk.sks }} SKS · {{ mk.status }}</span>
          </li>
        </ul>
      </section>

      <section v-if="khs" class="rounded-2xl border border-navy/10 bg-white p-5">
        <h2 class="mb-2 text-lg font-bold text-navy">KHS — IPK {{ khs.ipk }}</h2>
        <div v-for="s in khs.semesters" :key="s.semester" class="mb-3">
          <h3 class="font-medium text-navy">{{ s.semester }} · IP {{ s.ip }} · {{ s.totalSks }} SKS</h3>
          <ul class="space-y-1 text-sm">
            <li v-for="n in s.nilai" :key="n.mataKuliah" class="flex justify-between gap-2">
              <span>{{ n.mataKuliah }}</span>
              <span class="shrink-0 text-navy-light">{{ n.nilaiHuruf }}</span>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>