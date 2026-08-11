<script setup lang="ts">
import { ref } from 'vue';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ChartIpTrend from './ChartIpTrend.vue';
import ChartGradeDistribution from './ChartGradeDistribution.vue';
import ChartSksCumulative from './ChartSksCumulative.vue';
import type { IpTrendRow, GradeDistRow, CumulativeSksRow } from '../utils/dashboard';

const props = defineProps<{
  ipTrendRows: IpTrendRow[];
  gradeRows: GradeDistRow[];
  sksRows: CumulativeSksRow[];
  ipMax: number;
}>();

const chartTab = ref<'ipTrend' | 'gradeDist'>('ipTrend');
</script>

<template>
  <section class="grid grid-cols-1 gap-6 xl:grid-cols-2">
    <Card>
      <CardContent class="p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-bold text-foreground">
              {{ chartTab === 'ipTrend' ? 'Tren Indeks Prestasi (IP)' : 'Distribusi Nilai Huruf' }}
            </h2>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ chartTab === 'ipTrend' ? 'Riwayat IP per semester' : 'Perolehan grade per semester' }}
            </p>
          </div>
          <div class="flex gap-1 text-xs">
            <Button variant="ghost" size="sm" :class="chartTab === 'ipTrend' ? 'bg-primary/10 font-semibold text-primary' : ''" data-test="tab-ip-trend" @click="chartTab = 'ipTrend'">Tren IP</Button>
            <Button variant="ghost" size="sm" :class="chartTab === 'gradeDist' ? 'bg-primary/10 font-semibold text-primary' : ''" data-test="tab-grade-dist" @click="chartTab = 'gradeDist'">Distribusi Nilai</Button>
          </div>
        </div>
        <ChartIpTrend v-if="chartTab === 'ipTrend'" :data="ipTrendRows" :ip-max="ipMax" />
        <ChartGradeDistribution v-else :data="gradeRows" />
      </CardContent>
    </Card>

    <Card>
      <CardContent class="p-5">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h2 class="text-base font-bold text-foreground">Akumulasi SKS Kumulatif</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">Pertumbuhan SKS menuju target kelulusan 144 SKS</p>
          </div>
          <span class="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">Target: 144 SKS</span>
        </div>
        <ChartSksCumulative :data="sksRows" />
      </CardContent>
    </Card>
  </section>
</template>