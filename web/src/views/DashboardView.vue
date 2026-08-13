<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDashboard } from '../composables/useDashboard';
import {
  taskStats,
  ipTrend,
  cumulativeSks,
  gradeDistribution,
  parseSchedule,
  parseJadwal,
} from '../utils/dashboard';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import DashboardHeader from '../components/DashboardHeader.vue';
import DashboardStats from '../components/DashboardStats.vue';
import AcademicCharts from '../components/AcademicCharts.vue';
import ScheduleSection from '../components/ScheduleSection.vue';
import DeadlineSection from '../components/DeadlineSection.vue';

const router = useRouter();
const d = useDashboard();

const ipkValue = computed(() => d.siap.value.khs?.ipk ?? d.siap.value.profile?.ipk ?? null);
const sksValue = computed(() => {
  if (typeof d.siap.value.profile?.sksLulus === 'number') return d.siap.value.profile.sksLulus;
  const khs = d.siap.value.khs;
  if (!khs) return null;
  return khs.semesters.reduce((s, x) => s + x.totalSks, 0);
});
const activeCourses = computed(() => d.kulon.value.courses.filter((c) => c.timelineStatus === 'inprogress').length);
const stats = computed(() => taskStats(d.kulon.value.assignments, d.kulon.value.courses));
const ipRows = computed(() => ipTrend(d.siap.value.khs));
const gradeRows = computed(() => gradeDistribution(d.siap.value.khs));
const sksRows = computed(() => cumulativeSks(d.siap.value.khs));
const ipMax = computed(() => Math.max(3, ...ipRows.value.map((r) => r.ip)));
const scheduleItems = computed(() => [...parseJadwal(d.siap.value.jadwal), ...parseSchedule(d.siap.value.irs)]);

function go(view: 'kulon') {
  router.push('/kulon/dashboard');
}
</script>

<template>
  <div class="space-y-8 overflow-x-clip">
    <DashboardHeader
      :name="d.siap.value.profile?.nama ?? 'Pengguna'"
      :prodi="d.siap.value.profile?.prodi ?? ''"
      :nim="d.siap.value.profile?.nim ?? ''"
      :angkatan="d.siap.value.profile?.angkatan ?? ''"
      :loading="d.siapLoading.value"
    />

    <div
      v-if="!d.siapLoading.value && !d.siapError.value && d.siap.value.profile == null"
      class="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground"
      data-test="siap-empty"
    >
      Belum ada session SIAP — silakan login ulang via SSO.
    </div>

    <Alert v-if="d.siapError.value" variant="destructive" class="bg-danger/10 p-4">
      <AlertTitle>Data akademik (SIAP)</AlertTitle>
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ d.siapError.value }}</span>
        <Button size="sm" variant="outline" @click="d.load">Coba lagi</Button>
      </AlertDescription>
    </Alert>

    <Alert v-if="d.kulonError.value" variant="destructive" class="bg-danger/10 p-4">
      <AlertTitle>Data tugas (Kulon)</AlertTitle>
      <AlertDescription class="flex items-center justify-between gap-3">
        <span>{{ d.kulonError.value }}</span>
        <Button size="sm" variant="outline" @click="d.load">Coba lagi</Button>
      </AlertDescription>
    </Alert>

    <DashboardStats
      :ipk="ipkValue"
      :sks-kumulatif="sksValue"
      :sks-semester="d.siap.value.irs?.totalSks ?? null"
      :active-courses="activeCourses"
      :need="stats.need"
      :late="stats.late"
      :done="stats.done"
      :loading-siap="d.siapLoading.value"
      :loading-kulon="d.kulonLoading.value"
      :has-kulon="!d.kulonError.value && d.kulon.value.assignments.length > 0"
    />

    <AcademicCharts
      :ip-trend-rows="ipRows"
      :grade-rows="gradeRows"
      :sks-rows="sksRows"
      :ip-max="ipMax"
    />

    <ScheduleSection :items="scheduleItems" :semester="d.siap.value.irs?.semester ?? null" :loading="d.siapLoading.value" />

    <DeadlineSection
      :assignments="d.kulon.value.assignments"
      :courses="d.kulon.value.courses"
      :loading="d.kulonLoading.value"
      :has-kulon="!d.kulonError.value && d.kulon.value.assignments.length > 0"
      @open="go('kulon')"
      @view-all="go('kulon')"
    />
  </div>
</template>