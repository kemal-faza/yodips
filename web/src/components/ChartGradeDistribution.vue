<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer, ChartCrosshair } from '@/components/ui/chart';
import { VisXYContainer, VisStackedBar, VisAxis } from '@unovis/vue';
import type { GradeDistRow, GradeKey } from '../utils/dashboard';

const props = defineProps<{ data: GradeDistRow[] }>();
// Reference palette (Website LMS untuk Kampus). All hex — var(--chart-1) is an
// HSL triplet and renders black when used bare; never use it here.
const config = {
  A:  { label: 'A',  color: '#16a34a' },
  AB: { label: 'AB', color: '#22c55e' },
  B:  { label: 'B',  color: '#3b82f6' },
  BC: { label: 'BC', color: '#6366f1' },
  C:  { label: 'C',  color: '#f59e0b' },
  D:  { label: 'D',  color: '#f97316' },
  E:  { label: 'E',  color: '#dc2626' },
} satisfies ChartConfig;

const keys: GradeKey[] = ['A', 'AB', 'B', 'BC', 'C', 'D', 'E'];
const colors = keys.map((k) => config[k].color as string);

// Unovis stacked bar positions bars on a NUMERIC x scale. Map index -> semester
// for the category axis labels below.
const xIndex = (d: GradeDistRow, i: number) => i;
const xLabel = (i: number) => String(i + 1);

/** mirror of the chart's color accessor — the legend must match the bars. */
const gradeColor = (k: GradeKey) => config[k].color as string;

/**
 * Custom hover tooltip, mirroring the reference CustomGradeTooltip: header
 * "Semester N", then only grades with count > 0 (colored dot + key + count).
 * The crosshair passes the data record (possibly wrapped as { data }) plus the
 * numeric x (datum index).
 */
function gradeTooltip(datum: unknown, x: number | Date): string {
  const maybe = datum && typeof datum === 'object' ? (datum as { data?: GradeDistRow }) : null;
  const row: GradeDistRow | undefined = maybe?.data ?? (datum as GradeDistRow | undefined);
  const label = `Semester ${(typeof x === 'number' ? Math.round(x) : 0) + 1}`;
  const rows = keys
    .filter((k) => (row?.[k] ?? 0) > 0)
    .map(
      (k) => `
      <div class="flex items-center justify-between gap-4">
        <span class="flex items-center gap-1.5 font-bold" style="color: ${gradeColor(k)}">
          <span class="h-2 w-2 rounded-full shrink-0" style="background-color: ${gradeColor(k)}"></span>
          ${k} :
        </span>
        <span class="font-bold text-foreground">${row?.[k] ?? 0}</span>
      </div>`,
    )
    .join('');
  return `
    <div class="border border-border bg-card p-3 shadow-md font-label text-xs">
      <div class="mb-1.5 border-b border-border pb-1 font-bold text-foreground">${label}</div>
      <div class="min-w-[100px] space-y-1">
        ${rows.length > 0 ? rows : '<div class="text-muted-foreground">Tidak ada data</div>'}
      </div>
    </div>`;
}
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <template v-else>
    <ChartContainer :config="config" class="h-64 w-full" cursor>
      <VisXYContainer :data="props.data" :x="xIndex">
        <VisStackedBar
          :x="xIndex"
          :y="keys.map((k) => (d: GradeDistRow) => (d[k] ?? 0))"
          :color="colors"
          bar-padding="0.15"
        />
        <VisAxis type="x" :grid-line="false" :tick-format="xLabel" />
        <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
        <ChartCrosshair :template="gradeTooltip" />
      </VisXYContainer>
    </ChartContainer>
    <div class="mt-3 flex flex-wrap items-center justify-center gap-3 border-t border-border pt-3 font-label text-xs">
      <div v-for="c in keys" :key="c" class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5" :style="{ backgroundColor: config[c].color }" />
        <span class="font-semibold text-foreground">{{ c }}</span>
      </div>
    </div>
  </template>
</template>
