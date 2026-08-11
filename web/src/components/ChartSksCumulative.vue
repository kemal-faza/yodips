<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer } from '@/components/ui/chart';
import { VisXYContainer, VisArea, VisAxis, VisPlotline } from '@unovis/vue';
import type { CumulativeSksRow } from '../utils/dashboard';

const props = defineProps<{ data: CumulativeSksRow[] }>();

const config = { sks: { label: 'SKS Kumulatif', color: 'var(--primary)' } } satisfies ChartConfig;
const target = 144;

const xIndex = (d: CumulativeSksRow, i: number) => i;
const xLabel = (i: number) => props.data[i]?.semester ?? '';
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <ChartContainer v-else :config="config" class="h-64 w-full">
    <VisXYContainer :data="props.data" :x="xIndex" :y="(d: CumulativeSksRow) => d.sksKumulatif" :y-domain="[0, 160]">
      <VisArea :x="xIndex" :y="(d: CumulativeSksRow) => d.sksKumulatif" color="var(--primary)" :opacity="0.15" />
      <VisPlotline :value="target" axis="y" color="var(--danger)" :line-style="[4, 4]" />
      <VisAxis type="x" :grid-line="false" :tick-format="xLabel" />
      <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
    </VisXYContainer>
  </ChartContainer>
</template>