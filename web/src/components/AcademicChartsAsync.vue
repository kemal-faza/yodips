<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import type { Component } from 'vue';
import type { CumulativeSksRow, GradeDistRow, IpTrendRow } from '../utils/dashboard';

const props = defineProps<{
  ipTrendRows: IpTrendRow[];
  gradeRows: GradeDistRow[];
  sksRows: CumulativeSksRow[];
  ipMax: number;
}>();

const chartComponent = shallowRef<Component | null>(null);
const status = ref<'loading' | 'ready' | 'error'>('loading');

async function load() {
  status.value = 'loading';
  chartComponent.value = null;
  try {
    const module = await import('./AcademicCharts.vue');
    chartComponent.value = module.default;
    status.value = 'ready';
  } catch {
    status.value = 'error';
  }
}

onMounted(load);
</script>

<template>
  <section
    v-if="status === 'loading'"
    class="grid grid-cols-1 gap-6 2xl:grid-cols-2"
    data-test="academic-charts-loading"
    aria-busy="true"
    aria-live="polite"
  >
    <div
      v-for="slot in 2"
      :key="slot"
      class="h-80 rounded-xl bg-card p-5 motion-safe:animate-pulse surface-raised"
      aria-hidden="true"
    />
    <span class="sr-only">Memuat grafik akademik…</span>
  </section>

  <section
    v-else-if="status === 'error'"
    class="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger"
    data-test="academic-charts-error"
    role="alert"
  >
    <p class="font-semibold">Grafik akademik gagal dimuat.</p>
    <button
      type="button"
      class="mt-3 rounded-md border border-danger/40 px-3 py-1.5 font-medium hover:bg-danger/10"
      data-test="academic-charts-retry"
      @click="load"
    >
      Coba lagi
    </button>
  </section>

  <component
    :is="chartComponent"
    v-else
    :ip-trend-rows="props.ipTrendRows"
    :grade-rows="props.gradeRows"
    :sks-rows="props.sksRows"
    :ip-max="props.ipMax"
  />
</template>
