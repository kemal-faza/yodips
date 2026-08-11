<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer } from '@/components/ui/chart';
import { VisXYContainer, VisStackedBar, VisAxis } from '@unovis/vue';
import type { GradeDistRow, GradeKey } from '../utils/dashboard';

const props = defineProps<{ data: GradeDistRow[] }>();

const config = {
  A: { label: 'A', color: '#16a34a' },
  AB: { label: 'AB', color: '#22c55e' },
  B: { label: 'B', color: 'var(--chart-1)' },
  BC: { label: 'BC', color: '#6366f1' },
  C: { label: 'C', color: '#f59e0b' },
  D: { label: 'D', color: '#f97316' },
  E: { label: 'E', color: '#dc2626' },
} satisfies ChartConfig;

const keys: GradeKey[] = ['A', 'AB', 'B', 'BC', 'C', 'D', 'E'];
const colors = keys.map((k) => config[k].color as string);

// Unovis stacked bar positions bars on a NUMERIC x scale. Map index -> semester
// for the category axis labels below.
const xIndex = (d: GradeDistRow, i: number) => i;
const xLabel = (i: number) => String(i + 1);
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <template v-else>
    <ChartContainer :config="config" class="h-64 w-full">
      <VisXYContainer :data="props.data" :x="xIndex">
        <VisStackedBar
          :x="xIndex"
          :y="keys.map((k) => (d: GradeDistRow) => (d[k] ?? 0))"
          :color="colors"
          bar-padding="0.15"
        />
        <VisAxis type="x" :grid-line="false" :tick-format="xLabel" />
        <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
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
