<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue';
import { getSiapAbsen, getSiapJadwal, getSiapLecturers } from '../../api/client';
import type { SiapAbsenItem, SiapJadwal } from '../../types';
import {
  MONTH_NAMES_ID,
  WEEKDAY_SHORT,
  currentCalendarMonth,
  eventsByTanggal,
  monthGrid,
  monthTitle,
  toDateIso,
} from '../../utils/calendar';
import ScheduleCardMobile from '../components/ScheduleCardMobile.vue';

const loading = ref(true);
const error = ref<string | null>(null);
const jadwal = ref<SiapJadwal[]>([]);
const lecturerByKode = ref(new Map<string, string>());
const absenByNama = ref(new Map<string, SiapAbsenItem>());

const byTanggal = computed(() => eventsByTanggal(jadwal.value));
const ym = ref(currentCalendarMonth(byTanggal.value));
const selected = ref<string | null>(null);
const pickerOpen = ref(false);

const yearNum = computed(() => Number(ym.value.slice(0, 4)));
const monthNum = computed(() => Number(ym.value.slice(5, 7)));
const cells = computed(() => monthGrid(yearNum.value, monthNum.value));
const dayCards = computed(() => (selected.value ? byTanggal.value.get(selected.value) ?? [] : []));

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(day: number): string {
  return `${ym.value}-${pad(day)}`;
}

function hasEvent(day: number): boolean {
  return byTanggal.value.has(dateKey(day));
}

function isToday(day: number): boolean {
  return dateKey(day) === toDateIso(new Date());
}

function pickMonth(m: number): void {
  ym.value = `${yearNum.value}-${pad(m)}`;
  pickerOpen.value = false;
}

function shiftYear(delta: number): void {
  ym.value = `${yearNum.value + delta}-${pad(monthNum.value)}`;
}

function lecturerFor(j: SiapJadwal): string | null {
  return (j.kode && lecturerByKode.value.get(j.kode)) || null;
}

function absenFor(j: SiapJadwal): SiapAbsenItem | null {
  return absenByNama.value.get(j.matakuliah.trim().toLowerCase()) ?? null;
}

onMounted(async () => {
  try {
    const [j, l, a] = await Promise.all([getSiapJadwal(), getSiapLecturers(), getSiapAbsen()]);
    jadwal.value = j;
    lecturerByKode.value = new Map(l.filter((x) => x.dosen).map((x) => [x.kode, x.dosen]));
    absenByNama.value = new Map(a.map((x) => [x.nama.trim().toLowerCase(), x]));
    ym.value = currentCalendarMonth(byTanggal.value);
    // Default selection: today bila ber-event, else event pertama (port Kotlin).
    const todayIso = toDateIso(new Date());
    selected.value = byTanggal.value.has(todayIso)
      ? todayIso
      : ([...byTanggal.value.keys()][0] ?? null);
  } catch (e: unknown) {
    const anyE = e as { response?: { data?: { message?: string } } };
    error.value = anyE.response?.data?.message ?? 'Gagal memuat jadwal.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">Memuat jadwal…</div>
    <div v-else-if="error" class="rounded-xl bg-danger/10 p-4 text-sm text-danger">{{ error }}</div>

    <template v-else>
      <!-- Kalender -->
      <section class="rounded-xl border border-border bg-card p-4">
        <button
          type="button"
          data-test="cal-header"
          class="mx-auto flex cursor-pointer items-center gap-1 text-sm font-bold text-foreground"
          @click="pickerOpen = true"
        >
          <CalendarDays class="size-4 text-primary" aria-hidden="true" />
          {{ monthTitle(yearNum, monthNum) }}
          <ChevronDown class="size-4 text-muted-foreground" aria-hidden="true" />
        </button>

        <div class="mt-3 grid grid-cols-7 text-center">
          <span
            v-for="w in WEEKDAY_SHORT"
            :key="w"
            data-test="weekday"
            class="text-[10px] font-medium uppercase text-muted-foreground"
          >{{ w }}</span>
        </div>
        <div class="mt-1 grid grid-cols-7 gap-y-1 text-center">
          <template v-for="(c, i) in cells" :key="i">
            <button
              v-if="c"
              type="button"
              :data-test="'day-' + c"
              class="relative mx-auto flex size-9 cursor-pointer items-center justify-center rounded-full text-sm transition-colors"
              :class="[
                selected === dateKey(c)
                  ? 'bg-primary font-bold text-primary-foreground'
                  : 'text-foreground hover:bg-muted',
                isToday(c) && selected !== dateKey(c) && 'ring-1 ring-primary',
              ]"
              @click="selected = dateKey(c)"
            >
              {{ c }}
              <span
                v-if="hasEvent(c)"
                data-test="event-dot"
                class="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full"
                :class="selected === dateKey(c) ? 'bg-primary-foreground' : 'bg-primary'"
              />
            </button>
            <span v-else />
          </template>
        </div>
      </section>

      <!-- Kartu jadwal tanggal terpilih -->
      <div v-if="dayCards.length === 0" class="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        Tidak ada jadwal di tanggal ini.
      </div>
      <div v-else class="space-y-2">
        <ScheduleCardMobile
          v-for="(j, i) in dayCards"
          :key="i"
          :jadwal="j"
          :lecturer="lecturerFor(j)"
          :absen="absenFor(j)"
        />
      </div>

      <!-- Picker bulan/tahun -->
      <Teleport to="body">
        <div
          v-if="pickerOpen"
          data-test="month-picker"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          @click.self="pickerOpen = false"
        >
          <div class="w-full max-w-xs rounded-xl border border-border bg-card p-4">
            <div class="flex items-center justify-between">
              <button type="button" data-test="year-prev" aria-label="Tahun sebelumnya"
                class="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground" @click="shiftYear(-1)">
                <ChevronLeft class="size-4" />
              </button>
              <span class="text-sm font-bold text-foreground">{{ yearNum }}</span>
              <button type="button" data-test="year-next" aria-label="Tahun berikutnya"
                class="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground" @click="shiftYear(1)">
                <ChevronRight class="size-4" />
              </button>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-2">
              <button
                v-for="(m, idx) in MONTH_NAMES_ID"
                :key="m"
                type="button"
                data-test="pick-month"
                class="cursor-pointer rounded-lg border border-border px-2 py-2 text-xs font-medium transition-colors"
                :class="idx + 1 === monthNum ? 'border-primary bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'"
                @click="pickMonth(idx + 1)"
              >{{ m.slice(0, 3) }}</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
