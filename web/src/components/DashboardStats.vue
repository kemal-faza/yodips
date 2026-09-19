<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton';
import { Award, Layers, BookMarked, ClipboardList } from '@lucide/vue';

const props = defineProps<{
  ipk: number | null;
  sksKumulatif: number | null;
  sksSemester: number | null;
  activeCourses: number;
  need: number;
  late: number;
  done: number;
  loadingSiap: boolean;
  loadingKulon: boolean;
  hasKulon: boolean;
}>();

function pct(v: number | null, max: number): string {
  if (v == null || max <= 0) return '0%';
  return `${Math.min(100, (v / max) * 100)}%`;
}
</script>

<template>
  <div class="grid grid-cols-1 gap-6 md:grid-cols-3" :data-test="loadingSiap || loadingKulon ? 'stats-loading' : undefined">
    <!-- Hero: yang harus dikerjakan sekarang. Satu baris penuh di atas tiga
         metrik akademik, dan satu-satunya tile dengan elevasi lebih tinggi. -->
    <div v-if="loadingKulon" class="space-y-2.5 md:col-span-3">
      <Skeleton class="h-32 rounded-xl surface-raised" />
    </div>
    <div v-else class="rounded-xl bg-card p-6 surface-lifted md:col-span-3">
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statistik Tugas</span>
            <ClipboardList :size="16" class="text-muted-foreground" aria-hidden="true" />
          </div>
          <div class="mt-2.5 flex items-baseline gap-2">
            <span class="text-4xl font-extrabold tracking-tight text-foreground">{{ hasKulon ? need : '—' }}</span>
            <span class="text-xs text-muted-foreground">Perlu Dikerjakan</span>
          </div>
        </div>
        <div v-if="hasKulon" class="flex flex-wrap items-center gap-2 text-[10px]">
          <span v-if="late > 0" class="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 font-semibold text-danger">{{ late }} Terlambat</span>
          <span class="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-semibold text-success">{{ done }} Selesai</span>
        </div>
      </div>
    </div>

    <!-- Tiga metrik akademik, sejajar. -->
    <div v-if="loadingSiap" class="space-y-2.5">
      <Skeleton class="h-32 rounded-xl surface-raised" />
    </div>
    <div v-else class="space-y-2.5 rounded-xl bg-card p-5 surface-raised">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IP Kumulatif (IPK)</span>
        <Award :size="16" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ ipk?.toFixed(2) ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 4.00</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-all" :style="{ width: pct(ipk, 4) }" />
      </div>
    </div>

    <div v-if="loadingSiap" class="space-y-2.5">
      <Skeleton class="h-32 rounded-xl surface-raised" />
    </div>
    <div v-else class="space-y-2.5 rounded-xl bg-card p-5 surface-raised">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKS Kumulatif</span>
        <Layers :size="16" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ sksKumulatif ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 144 SKS</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-all" :style="{ width: pct(sksKumulatif, 144) }" />
      </div>
    </div>

    <div v-if="loadingSiap" class="space-y-2.5">
      <Skeleton class="h-32 rounded-xl surface-raised" />
    </div>
    <div v-else class="space-y-2.5 rounded-xl bg-card p-5 surface-raised">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKS Semester Ini</span>
        <BookMarked :size="16" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ sksSemester ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 24</span>
      </div>
      <span class="block text-[11px] text-muted-foreground">{{ activeCourses }} Mata Kuliah Berjalan</span>
    </div>
  </div>
</template>
