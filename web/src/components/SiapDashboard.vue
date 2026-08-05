/**
 * SiapDashboard — the "Dasbor" tab of the SIAP view.
 *
 * Fetches the IRS (rencana studi) and KHS (hasil studi) on mount and
 * auto-polls every 30s while the document is visible, preserving the
 * behavior of the previous Akademik panel. Renders status, prestasi,
 * IRS, KHS and a Quick Link grid.
 */
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { getSiapIrs, getSiapKhs } from '../api/client';
import type { SiapIrs, SiapKhs, SiapProfile } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const props = defineProps<{ profile: SiapProfile | null; hasSiap: boolean }>();

const POLL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

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
    const [i, k] = await Promise.all([getSiapIrs(), getSiapKhs()]);
    irs.value = i;
    khs.value = k;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? 'Gagal memuat data akademik';
  } finally {
    loading.value = false;
    inFlight = false;
  }
}

onMounted(() => {
  if (props.hasSiap) {
    load();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
  }
});

onUnmounted(() => clearInterval(timer!));
</script>

<template>
  <div
    v-if="!hasSiap"
    class="rounded-2xl border border-line bg-surface p-6 text-center text-ink-muted"
  >
    Belum ada session SIAP — silakan login ulang via SSO.
  </div>
  <div v-else class="space-y-6">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wide text-ink-muted">Dasbor</span>
      <Button
        variant="outline"
        class="rounded-full bg-navy px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-light"
        @click="load"
      >
        Segarkan
      </Button>
    </div>

    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-24 rounded-card" />
    </div>

    <div v-else-if="error" class="rounded-2xl bg-danger/10 p-4 text-danger">{{ error }}</div>

    <template v-else>
      <section class="grid gap-4 sm:grid-cols-2">
        <Card class="rounded-2xl border-line bg-surface">
          <CardContent class="p-5">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Status Akademik</h2>
            <dl class="mt-3 space-y-2 text-sm">
              <div class="flex justify-between gap-2">
                <dt class="text-ink-muted">Semester</dt>
                <dd class="font-medium text-ink">{{ profile?.semesterBerjalan ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-ink-muted">Status</dt>
                <dd class="font-medium text-ink">{{ profile?.status ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-ink-muted">Prodi</dt>
                <dd class="font-medium text-ink">{{ profile?.prodi ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-ink-muted">Angkatan</dt>
                <dd class="font-medium text-ink">{{ profile?.angkatan ?? '—' }}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card class="rounded-2xl border-line bg-surface">
          <CardContent class="p-5">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Prestasi</h2>
            <div class="mt-3 flex items-end gap-6">
              <div>
                <p class="text-3xl font-bold text-primary-600 dark:text-primary-400">{{ khs?.ipk?.toFixed(2) ?? '—' }}</p>
                <p class="text-xs text-ink-muted">IPK</p>
              </div>
              <div>
                <p class="text-3xl font-bold text-primary-600 dark:text-primary-400">{{ irs?.totalSks ?? '—' }}</p>
                <p class="text-xs text-ink-muted">SKS Semester Ini</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card class="rounded-2xl border-line bg-surface">
        <CardContent class="p-5">
          <h2 class="mb-2 font-semibold text-ink">IRS — {{ irs?.semester || 'Semester Aktif' }}</h2>
          <p class="mb-2 text-sm text-ink-muted">Total SKS: {{ irs?.totalSks ?? 0 }}</p>
          <ul v-if="irs?.mataKuliah?.length" class="divide-y divide-line text-sm">
            <li v-for="mk in irs.mataKuliah" :key="mk.kode" class="flex justify-between gap-2 py-1.5">
              <span>{{ mk.kode }} — {{ mk.nama }}</span>
              <span class="shrink-0 text-ink-muted">{{ mk.sks }} SKS &middot; {{ mk.status }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-ink-muted">Belum ada data IRS.</p>
        </CardContent>
      </Card>

      <Card class="rounded-2xl border-line bg-surface">
        <CardContent class="p-5">
          <h2 class="mb-2 font-semibold text-ink">KHS — IPK {{ khs?.ipk?.toFixed(2) ?? '—' }}</h2>
          <div v-for="s in khs?.semesters ?? []" :key="s.semester" class="mb-3">
            <h3 class="font-medium text-ink">{{ s.semester }} &middot; IP {{ s.ip }} &middot; {{ s.totalSks }} SKS</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="n in s.nilai" :key="n.mataKuliah" class="flex justify-between gap-2">
                <span>{{ n.mataKuliah }}</span>
                <span class="shrink-0 text-ink-muted">{{ n.nilaiHuruf }}</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
      <Card class="rounded-2xl border-line bg-surface">
        <CardContent class="p-5">
          <h2 class="mb-2 font-semibold text-ink">Quick Link</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div
              v-for="q in ['KRS Online', 'Registrasi Ulang', 'KTM Digital', 'Transkrip', 'SKPI', 'Bebas Perpustakaan']"
              :key="q"
              class="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink-muted"
            >
              {{ q }}
              <Badge class="ml-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-ink">
                Coming Soon
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
