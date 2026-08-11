<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString } from '@/components/ui/chart';
import { VisXYContainer, VisLine, VisAxis, VisPlotline, VisScatter } from '@unovis/vue';
import type { IpTrendRow } from '../utils/dashboard';

const props = defineProps<{ data: IpTrendRow[]; ipMax: number }>();

const config = { ip: { label: 'IP Semester', color: 'var(--primary)' } } satisfies ChartConfig;

// Unovis xy charts position on a NUMERIC x scale. The filtered data is
// contiguous from semester 1, so index+1 == the ordinal semester number.
const xIndex = (d: IpTrendRow, i: number) => i;
const xLabel = (i: number) => String(i + 1);

// Tooltip label: the crosshair passes the numeric x (the datum index) as `x`.
// Param must be `number | Date` — ChartTooltipContent declares
// `labelFormatter?: (d: number | Date) => string` (strictFunctionTypes).
const labelFormatter = (d: number | Date) => `Semester ${(typeof d === 'number' ? d : 0) + 1}`;
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <ChartContainer v-else :config="config" class="h-64 w-full" cursor>
    <VisXYContainer :data="props.data" :x="xIndex" :y="(d: IpTrendRow) => d.ip" :y-domain="[0, 4]">
      <VisLine :x="xIndex" :y="(d: IpTrendRow) => d.ip" color="var(--primary)" :line-width="2.5" />
      <VisScatter :x="xIndex" :y="(d: IpTrendRow) => d.ip" :size="8" color="var(--primary)" />
      <VisPlotline
        :value="props.ipMax"
        axis="y"
        color="var(--color-success)"
        label-color="var(--color-success)"
        :line-style="[3, 3]"
        :label-text="`Max: ${props.ipMax.toFixed(2)}`"
        label-position="top"
      />
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
