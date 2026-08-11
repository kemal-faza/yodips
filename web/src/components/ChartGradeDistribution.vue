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
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <ChartContainer v-else :config="config" class="h-64 w-full">
    <VisXYContainer :data="props.data" :x="(d: GradeDistRow) => d.semester">
      <VisStackedBar :x="(d: GradeDistRow) => d.semester" :y="keys.map((k) => (d: GradeDistRow) => d[k])" :color="colors" />
      <VisAxis type="x" :grid-line="false" :tick-format="(d: string) => d" />
      <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
    </VisXYContainer>
  </ChartContainer>
</template>