<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString } from '@/components/ui/chart';
import { VisXYContainer, VisArea, VisAxis, VisPlotline, VisScatter } from '@unovis/vue';
import type { CumulativeSksRow } from '../utils/dashboard';

const props = defineProps<{ data: CumulativeSksRow[] }>();

const config = { sks: { label: 'SKS Kumulatif', color: 'var(--primary)' } } satisfies ChartConfig;
const target = 144;

const xIndex = (d: CumulativeSksRow, i: number) => i;
const xLabel = (i: number) => props.data[i]?.semester ?? '';

// Tooltip label uses the ordinal number, consistent with the IP chart.
// Param must be `number | Date` — see Task 1's labelFormatter note.
const labelFormatter = (d: number | Date) => `Semester ${(typeof d === 'number' ? d : 0) + 1}`;
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <ChartContainer v-else :config="config" class="h-64 w-full" cursor>
    <VisXYContainer :data="props.data" :x="xIndex" :y="(d: CumulativeSksRow) => d.sksKumulatif" :y-domain="[0, 160]">
      <VisArea :x="xIndex" :y="(d: CumulativeSksRow) => d.sksKumulatif" color="var(--primary)" :opacity="0.15" />
      <VisScatter :x="xIndex" :y="(d: CumulativeSksRow) => d.sksKumulatif" :size="8" color="var(--primary)" />
      <VisPlotline :value="target" axis="y" color="var(--danger)" :line-style="[4, 4]" label-text="Target Lulus 144 SKS" label-position="top" />
      <VisAxis type="x" :grid-line="false" :tick-format="xLabel" />
      <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
      <ChartCrosshair
        color="var(--primary)"
        :circle-radius="6"
        :template="componentToString(config, ChartTooltipContent, { labelFormatter, hideIndicator: false, class: 'rounded-none' })"
      />
      <ChartTooltip />
    </VisXYContainer>
  </ChartContainer>
</template>