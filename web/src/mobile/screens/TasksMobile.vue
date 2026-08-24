<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Search } from '@lucide/vue';
import { useKulonStore } from '../../stores/kulon';
import { useKulonSession } from '../../composables/useKulonSession';
import {
  matchesKulonFilter,
  isDone,
  courseActive,
  type KulonFilterKey,
} from '../../utils/assignment';
import type { Assignment } from '../../types';
import { pagedTasks, TASK_PAGE_SIZE } from '../../utils/pagination';

const store = useKulonStore();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();

// Normalisasi via computed (bukan auto-unwrap template) agar cabang v-if benar
// baik dengan ref asli maupun kotak polos { value } saat composable di-mock.
const expired = computed(() => !!sessionExpired.value);
const errMsg = computed(() => error.value ?? '');

const loading = ref(false);
const filter = ref<KulonFilterKey>('need');
const query = ref('');
const showCount = ref(TASK_PAGE_SIZE);

async function load(): Promise<void> {
  loading.value = true;
  clear();
  try {
    await Promise.all([store.ensureCourses(), store.ensureAssignments()]);
  } catch (e: unknown) {
    error.value = extract(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Ganti filter/search reset ke halaman pertama (ala LaunchedEffect(filter) Kotlin).
watch([filter, query], () => {
  showCount.value = TASK_PAGE_SIZE;
});

// Label persis spec §7 / taskBucketLabel Android (Common.kt) — jangan dipersingkat.
const CHIPS: Array<{ key: KulonFilterKey; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'need', label: 'Perlu dikerjakan' },
  { key: 'done', label: 'Sudah dikerjakan' },
  { key: 'late', label: 'Terlambat' },
];

const visible = computed<Assignment[]>(() =>
  store.assignments
    .filter((a) => matchesKulonFilter(filter.value, a, store.courses))
    .filter((a) => {
      const q = query.value.trim().toLowerCase();
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.course.toLowerCase().includes(q);
    })
    .sort((a, b) => a.duedate - b.duedate),
);

const paged = computed(() => pagedTasks(visible.value, showCount.value));

// NB: di script akses via .value (di template auto-unwrap).
const remainingVisible = computed(() => paged.value.remaining > 0 && !expired.value && !errMsg.value && !loading.value);

function bucketOf(a: Assignment): string | null {
  if (isDone(a)) return 'Sudah dikerjakan';
  if (a.overdue) return 'Terlambat';
  if (courseActive(a, store.courses)) return 'Perlu dikerjakan';
  return null;
}

function pillKey(a: Assignment): string {
  const b = bucketOf(a);
  return b === 'Sudah dikerjakan' ? 'done' : b === 'Terlambat' ? 'late' : 'need';
}

function pillClass(a: Assignment): string {
  switch (bucketOf(a)) {
    case 'Sudah dikerjakan': return 'bg-success/15 text-success';
    case 'Terlambat': return 'bg-danger text-white';
    default: return 'bg-primary/15 text-primary dark:text-primary-foreground';
  }
}

function fmtDue(a: Assignment): string {
  if (!a.duedate) return 'Tanpa deadline';
  return new Date(a.duedate * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
</script>

<template>
  <div class="space-y-3">
    <!-- Filter chips -->
    <div class="flex gap-2 overflow-x-auto pb-1" data-test="chips">
      <button
        v-for="c in CHIPS"
        :key="c.key"
        type="button"
        :data-test="'chip-' + c.key"
        class="shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
        :class="filter === c.key
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground'"
        @click="filter = c.key"
      >
        {{ c.label }}
      </button>
    </div>

    <!-- Search -->
    <div class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        v-model="query"
        data-test="task-search"
        type="search"
        placeholder="Cari tugas…"
        class="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>

    <!-- Error / stale -->
    <div v-if="expired" data-test="session-expired" class="rounded-xl border border-gold/40 bg-gold/20 p-4 text-center">
      <p class="text-sm font-semibold text-foreground">Session login kedaluwarsa</p>
      <button
        type="button"
        class="mt-2 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        :disabled="loading"
        @click="relogin"
      >Login Ulang</button>
    </div>
    <div v-else-if="errMsg" class="rounded-xl border border-destructive/30 bg-danger/10 p-4 text-sm text-danger">
      {{ errMsg }}
      <button type="button" class="ml-2 cursor-pointer font-semibold underline" @click="load">Coba lagi</button>
    </div>

    <!-- Daftar -->
    <div v-else-if="loading" class="py-10 text-center text-sm text-muted-foreground">Memuat tugas…</div>
    <div v-else-if="paged.page.length === 0" class="py-10 text-center text-sm text-muted-foreground" data-test="tasks-empty">
      Tidak ada tugas pada filter ini.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="a in paged.page"
        :key="a.id"
        data-test="task-row"
        class="rounded-xl border p-3"
        :class="bucketOf(a) === 'Terlambat' ? 'border-danger/40 bg-danger/5' : 'border-border bg-card'"
      >
        <div class="flex items-start justify-between gap-3">
          <p class="min-w-0 flex-1 text-sm font-semibold leading-snug" :class="bucketOf(a) === 'Terlambat' ? 'text-danger' : 'text-foreground'">
            {{ a.name }}
          </p>
          <span
            v-if="bucketOf(a)"
            :data-test="'pill-' + pillKey(a)"
            class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
            :class="pillClass(a)"
          >{{ bucketOf(a) }}</span>
        </div>
        <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ a.course }}</p>
        <p class="mt-0.5 text-xs text-foreground">Deadline: {{ fmtDue(a) }}</p>
      </li>
    </ul>

    <!-- Footer paginasi -->
    <button
      v-if="remainingVisible"
      type="button"
      data-test="load-more"
      class="w-full cursor-pointer rounded-lg border border-border bg-card py-2.5 text-sm font-semibold text-foreground active:bg-muted"
      @click="showCount += TASK_PAGE_SIZE"
    >
      Muat lebih banyak ({{ paged.remaining }} lagi)
    </button>
  </div>
</template>
