<script setup lang="ts">
import { computed } from 'vue';
import type { SiapAbsenItem, SiapJadwal } from '../../types';
import { formatWaktuEmDash } from '../../utils/calendar';

const props = defineProps<{
  jadwal: Pick<SiapJadwal, 'kode' | 'matakuliah' | 'ruang' | 'waktu' | 'hari' | 'sks'>;
  lecturer?: string | null;
  absen?: SiapAbsenItem | null;
}>();

const pct = computed<number | null>(() => {
  const a = props.absen;
  if (!a) return null;
  if (a.total > 0) return Math.round((a.hadir / a.total) * 100);
  return Math.round(a.hadirPct);
});
</script>

<template>
  <article class="rounded-xl border border-border bg-card p-4" data-test="schedule-card">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-foreground">{{ jadwal.matakuliah }}</p>
        <span
          v-if="jadwal.kode"
          class="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >{{ jadwal.kode }}</span>
      </div>
      <p class="shrink-0 text-right">
        <span class="block text-sm font-bold text-foreground">{{ formatWaktuEmDash(jadwal.waktu) }}</span>
        <span class="mt-0.5 block text-[10px] font-semibold text-muted-foreground">{{ jadwal.sks }} SKS</span>
      </p>
    </div>
    <dl class="mt-2 space-y-1 text-xs">
      <div v-if="jadwal.ruang" class="flex gap-1">
        <dt class="shrink-0 text-muted-foreground">Ruang:</dt>
        <dd class="text-foreground">{{ jadwal.ruang }}</dd>
      </div>
      <div v-if="lecturer" class="flex gap-1">
        <dt class="shrink-0 text-muted-foreground">Dosen:</dt>
        <dd class="text-foreground">{{ lecturer }}</dd>
      </div>
      <div v-if="absen" class="flex items-center gap-1">
        <dt class="shrink-0 text-muted-foreground">Kehadiran:</dt>
        <dd class="flex items-center gap-2 text-foreground" data-test="kehadiran">
          {{ absen.hadir }}/{{ absen.total }}
          <span class="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span
              class="block h-full bg-primary"
              data-test="kehadiran-bar"
              :style="{ width: pct + '%' }"
            />
          </span>
        </dd>
      </div>
    </dl>
  </article>
</template>
