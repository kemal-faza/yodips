<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useKulonStore } from '../stores/kulon';
import { useKulonSession } from '../composables/useKulonSession';
import { useAuthStore } from '../stores/auth';
import AssignmentCard from '../components/AssignmentCard.vue';
import DetailPanel from '../components/DetailPanel.vue';
import PaginationBar from '../components/PaginationBar.vue';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from '@lucide/vue';
import { matchesKulonFilter, courseActive } from '../utils/assignment';
import type { Assignment } from '../types';

const PAGE_SIZE = 20;

const store = useKulonStore();
const auth = useAuthStore();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();

const search = ref('');
const page = ref(1);
const view = ref<'all' | 'need' | 'done' | 'late'>('need');
const loading = ref(false);
const selected = ref<Assignment | null>(null);
const panelOpen = ref(false);

const filters = [
  { key: 'all', label: 'Semua' },
  { key: 'need', label: 'Perlu dikerjakan' },
  { key: 'done', label: 'Sudah dikerjakan' },
  { key: 'late', label: 'Terlambat' },
] as const;

/** Semester label of the course an assignment belongs to (null if unknown). */
function courseSemester(a: Assignment): string | null {
  return store.courses.find((c) => c.id === a.courseId)?.semester ?? null;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = [...store.assignments]
    .filter((a) => !store.isHidden(a.id))
    .filter((a) => matchesKulonFilter(view.value, a, store.courses))
    // "perlu dikerjakan": sort by nearest deadline (earliest first);
    // everywhere else: newest semester first, then newest deadline first.
    .sort((a, b) => {
      if (view.value === 'need') {
        const a0 = a.duedate || Number.POSITIVE_INFINITY;
        const b0 = b.duedate || Number.POSITIVE_INFINITY;
        return a0 - b0;
      }
      const ra = courseActive(a, store.courses) ? 0 : 1;
      const rb = courseActive(b, store.courses) ? 0 : 1;
      if (ra !== rb) return ra - rb; // active-semester tasks first
      const sa = courseSemester(a) ?? '';
      const sb = courseSemester(b) ?? '';
      if (sa !== sb) return String(sb).localeCompare(String(sa));
      return (b.duedate || 0) - (a.duedate || 0);
    });
  if (!q) return list;
  return list.filter((a) => a.name.toLowerCase().includes(q) || a.course.toLowerCase().includes(q));
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const pageItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

const hiddenAssignments = computed(() =>
  store.assignments.filter((a) => store.isHidden(a.id)),
);

watch(search, () => { page.value = 1; });
watch(view, () => { page.value = 1; });

async function load() {
  loading.value = true;
  clear();
  try {
    await Promise.all([store.ensureAssignments(), store.ensureCourses()]);
  } catch (e) {
    error.value = extract(e);
  } finally {
    loading.value = false;
  }
}

async function reloadAfter() { await load(); }

function openDetail(a: Assignment) {
  // Quizzes have no detail endpoint — open the Kulon quiz page directly.
  if (a.module === 'quiz') {
    if (a.courseModuleId) {
      window.open(`https://kulon2.undip.ac.id/mod/quiz/view.php?id=${a.courseModuleId}`, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  selected.value = a;
  panelOpen.value = true;
}

load();
</script>

<template>
  <div class="flex min-h-full flex-col space-y-4">
    <!-- Full-width Search Bar -->
    <div class="relative w-full">
      <Search class="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        v-model="search"
        data-test="search"
        type="text"
        placeholder="Cari tugas atau mata kuliah…"
        class="w-full pl-10 h-11 bg-card text-sm border-border shadow-xs focus:ring-2 focus:ring-primary/20"
      />
    </div>

    <!-- Active Indicator Filter Pills -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="f in filters"
        :key="f.key"
        type="button"
        data-test="view-filter"
        class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 border cursor-pointer"
        :class="
          view === f.key
            ? 'bg-primary text-primary-foreground border-primary shadow-xs'
            : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
        "
        @click="view = f.key"
      >
        <span
          v-if="view === f.key"
          class="size-1.5 rounded-full bg-primary-foreground"
          aria-hidden="true"
        />
        {{ f.label }}
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Skeleton v-for="i in 6" :key="i" class="h-16 rounded-lg" />
    </div>

    <!-- Session Expired Alert -->
    <Alert v-else-if="sessionExpired" class="mt-4 gap-2 border-gold/40 bg-gold/20 p-6 text-center">
      <AlertTitle class="font-semibold text-foreground">Session login kedaluwarsa</AlertTitle>
      <AlertDescription class="text-sm text-muted-foreground">{{ error }}</AlertDescription>
      <Button class="mt-4 justify-self-center cursor-pointer" :disabled="auth.checking" @click="relogin(reloadAfter)">
        {{ auth.checking ? 'Memeriksa session…' : 'Login Ulang' }}
      </Button>
    </Alert>

    <!-- Error Alert -->
    <Alert v-else-if="error" variant="destructive" class="mt-4 bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2 cursor-pointer" @click="load">Coba lagi</Button>
    </Alert>

    <!-- Empty State -->
    <div v-else-if="pageItems.length === 0" class="flex flex-1 flex-col items-center justify-center text-center">
      <div class="size-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        <Search class="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p class="font-medium text-sm text-foreground">Tidak ada tugas yang cocok</p>
      <p class="text-xs text-muted-foreground mt-1">Coba sesuaikan kata kunci atau filter status.</p>
    </div>

    <!-- 2x2 Assignment Grid Layout -->
    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <AssignmentCard
        v-for="a in pageItems"
        :key="a.id"
        :assignment="a"
        :show-hide="view === 'need'"
        @open="openDetail(a)"
        @hide="store.hide(a.id)"
      />
    </div>

    <!-- Pagination -->
    <div v-if="pageItems.length > 0 && totalPages > 1" class="mt-5 flex justify-center">
      <PaginationBar :page="page" :total-pages="totalPages" @change="(p) => (page = p)" />
    </div>

    <!-- Assignment Detail Side Sheet -->
    <DetailPanel :assignment="selected" :open="panelOpen" @close="panelOpen = false" />

    <!-- Hidden (Restore) -->
    <section v-if="hiddenAssignments.length > 0" class="border-t border-border pt-4">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tugas tersembunyi ({{ hiddenAssignments.length }})
      </h2>
      <ul class="space-y-1.5">
        <li
          v-for="a in hiddenAssignments"
          :key="a.id"
          class="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="truncate text-sm text-foreground">{{ a.name }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ a.course }}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
            data-test="unhide-assignment"
            @click="store.unhide(a.id)"
          >
            Pulihkan
          </Button>
        </li>
      </ul>
    </section>
  </div>
</template>
