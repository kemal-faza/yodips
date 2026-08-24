<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight } from '@lucide/vue';
import { useDashboard } from '../../composables/useDashboard';
import { taskStats } from '../../utils/dashboard';
import { upcomingTasks } from '../../utils/assignment';
import { formatWaktuEmDash, todaysSchedule } from '../../utils/calendar';

const router = useRouter();
const d = useDashboard();

const ipk = computed(() => d.siap.value.khs?.ipk ?? d.siap.value.profile?.ipk ?? null);
const sksLulus = computed(() => d.siap.value.profile?.sksLulus ?? null);
const stats = computed(() => taskStats(d.kulon.value.assignments, d.kulon.value.courses));
const upcoming = computed(() => upcomingTasks(d.kulon.value.assignments, d.kulon.value.courses, 5));
const today = computed(() => todaysSchedule(d.siap.value.jadwal, new Date()));

function fmtDue(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
</script>

<template>
  <div class="space-y-5">
    <!-- Kartu sapaan -->
    <section class="rounded-xl bg-primary p-5 text-primary-foreground" data-test="greeting">
      <p class="text-xs opacity-80">{{ d.siap.value.profile?.prodi ?? '' }}</p>
      <h2 class="mt-0.5 text-lg font-bold leading-snug">Halo, {{ d.siap.value.profile?.nama ?? 'Pengguna' }}</h2>
      <p class="text-xs opacity-80">NIM {{ d.siap.value.profile?.nim ?? '—' }}</p>
    </section>

    <!-- Chip statistik -->
    <section class="grid grid-cols-4 gap-2" data-test="stat-chips">
      <div class="rounded-lg border border-border bg-card p-2 text-center">
        <p class="text-[10px] text-muted-foreground">IPK</p>
        <p class="text-sm font-bold" data-test="stat-ipk">{{ ipk ?? '—' }}</p>
      </div>
      <div class="rounded-lg border border-border bg-card p-2 text-center">
        <p class="text-[10px] text-muted-foreground">SKS</p>
        <p class="text-sm font-bold" data-test="stat-sks">{{ sksLulus ?? '—' }}</p>
      </div>
      <div class="rounded-lg border border-border bg-card p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Perlu</p>
        <p class="text-sm font-bold text-success" data-test="stat-need">{{ stats.need }}</p>
      </div>
      <div class="rounded-lg border border-border bg-card p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Telat</p>
        <p class="text-sm font-bold text-danger" data-test="stat-late">{{ stats.late }}</p>
      </div>
    </section>

    <!-- Pintasan -->
    <section class="grid grid-cols-3 gap-2">
      <button type="button" data-test="quick-irs"
        class="cursor-pointer rounded-lg border border-border bg-card py-2.5 text-center text-xs font-semibold text-foreground active:bg-muted"
        @click="router.push('/irs')">IRS</button>
      <button type="button" data-test="quick-khs"
        class="cursor-pointer rounded-lg border border-border bg-card py-2.5 text-center text-xs font-semibold text-foreground active:bg-muted"
        @click="router.push('/khs')">KHS</button>
      <button type="button" data-test="quick-presensi"
        class="cursor-pointer rounded-lg border border-border bg-card py-2.5 text-center text-xs font-semibold text-foreground active:bg-muted"
        @click="router.push('/presensi')">Presensi</button>
    </section>

    <!-- Tugas terdekat -->
    <section>
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="text-sm font-bold text-foreground">Tugas Terdekat</h3>
        <button type="button" data-test="upcoming-all"
          class="flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          @click="router.push('/kulon/dashboard')">
          Lihat semua <ChevronRight class="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div v-if="upcoming.length === 0" class="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        Tidak ada tugas ber-deadline.
      </div>
      <ul v-else class="space-y-2">
        <li v-for="a in upcoming" :key="a.id" data-test="upcoming-row"
          class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-foreground">{{ a.name }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ a.course }}</p>
          </div>
          <p class="shrink-0 text-xs font-semibold" :class="a.overdue ? 'text-danger' : 'text-muted-foreground'">
            {{ fmtDue(a.duedate) }}
          </p>
        </li>
      </ul>
    </section>

    <!-- Jadwal hari ini -->
    <section>
      <h3 class="mb-2 text-sm font-bold text-foreground">Jadwal Hari Ini</h3>
      <div v-if="today.length === 0" class="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        Tidak ada jadwal hari ini.
      </div>
      <ul v-else class="space-y-2">
        <li v-for="(j, i) in today" :key="i" data-test="today-row"
          class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-foreground">{{ j.matakuliah }}</p>
            <p v-if="j.ruang" class="text-xs text-muted-foreground">{{ j.ruang }}</p>
          </div>
          <p class="shrink-0 text-xs font-semibold text-foreground">{{ formatWaktuEmDash(j.waktu) }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
