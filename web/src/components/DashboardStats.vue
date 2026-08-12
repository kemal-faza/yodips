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
  loading: boolean;
  hasKulon: boolean;
}>();

function pct(v: number | null, max: number): string {
  if (v == null || max <= 0) return '0%';
  return `${Math.min(100, (v / max) * 100)}%`;
}
</script>

<template>
  <div v-if="loading" data-test="stats-loading" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
    <Skeleton v-for="i in 4" :key="i" class="h-28 rounded-lg" />
  </div>
  <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
    <div class="space-y-2.5">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IP Kumulatif (IPK)</span>
        <Award :size="16" class="text-muted-foreground" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ ipk?.toFixed(2) ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 4.00</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden bg-muted">
        <div class="h-full bg-primary transition-all" :style="{ width: pct(ipk, 4) }" />
      </div>
    </div>

    <div class="space-y-2.5">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKS Kumulatif</span>
        <Layers :size="16" class="text-muted-foreground" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ sksKumulatif ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 144 SKS</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden bg-muted">
        <div class="h-full bg-primary transition-all" :style="{ width: pct(sksKumulatif, 144) }" />
      </div>
    </div>

    <div class="space-y-2.5">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKS Semester Ini</span>
        <BookMarked :size="16" class="text-muted-foreground" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ sksSemester ?? '—' }}</span>
        <span class="text-xs text-muted-foreground">/ 24</span>
      </div>
      <span class="block text-[11px] text-muted-foreground">{{ activeCourses }} Mata Kuliah Berjalan</span>
    </div>

    <div class="space-y-2.5">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statistik Tugas</span>
        <ClipboardList :size="16" class="text-muted-foreground" />
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-extrabold tracking-tight text-foreground">{{ hasKulon ? need : '—' }}</span>
        <span class="text-xs text-muted-foreground">Perlu Dikerjakan</span>
      </div>
      <div v-if="hasKulon" class="flex flex-wrap items-center gap-2 text-[10px]">
        <span v-if="late > 0" class="border border-danger/40 bg-danger/10 px-2 py-0.5 font-semibold text-danger">{{ late }} Terlambat</span>
        <span class="border border-success/40 bg-success/10 px-2 py-0.5 font-semibold text-success">{{ done }} Selesai</span>
      </div>
    </div>
  </div>
</template>