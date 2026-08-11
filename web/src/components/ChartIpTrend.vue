<script setup lang="ts">
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer } from '@/components/ui/chart';
import { VisXYContainer, VisLine, VisAxis, VisPlotline } from '@unovis/vue';
import type { IpTrendRow } from '../utils/dashboard';

const props = defineProps<{ data: IpTrendRow[]; ipMax: number }>();

const config = { ip: { label: 'IP Semester', color: 'var(--primary)' } } satisfies ChartConfig;
</script>

<template>
  <div v-if="data.length === 0" class="flex h-64 items-center justify-center text-sm text-muted-foreground" data-test="no-data">
    Tidak ada data
  </div>
  <ChartContainer v-else :config="config" class="h-64 w-full">
    <VisXYContainer :data="props.data" :x="(d: IpTrendRow) => d.semester" :y="(d: IpTrendRow) => d.ip" :y-domain="[3, 4]">
      <VisLine :x="(d: IpTrendRow) => d.semester" :y="(d: IpTrendRow) => d.ip" color="var(--primary)" />
      <VisPlotline :value="props.ipMax" axis="y" color="var(--danger)" :line-style="[3, 3]" />
      <VisAxis type="x" :grid-line="false" :tick-format="(d: string) => d" />
      <VisAxis type="y" :grid-line="true" :tick-line="false" :domain-line="false" />
    </VisXYContainer>
  </ChartContainer>
</template>