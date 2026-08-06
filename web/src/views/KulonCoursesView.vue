<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useKulonStore } from '../stores/kulon';
import { useAuthStore } from '../stores/auth';
import { useKulonSession } from '../composables/useKulonSession';
import { groupCoursesBySemester } from '../utils/kulon';
import CourseCard from '../components/CourseCard.vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight } from '@lucide/vue';

const store = useKulonStore();
const auth = useAuthStore();
const router = useRouter();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();
const loading = ref(false);
const pastExpanded = ref(false);

// Moodle's own timeline classification (backend `timelineStatus`) is the
// source of truth for "aktif": a course Moodle reports as 'inprogress' is
// the current semester. Semester name-parsing is display-only (sub-labels).
const activeCourses = computed(() => store.courses.filter((c) => c.timelineStatus === 'inprogress'));
const pastCourses = computed(() => store.courses.filter((c) => c.timelineStatus !== 'inprogress'));
const pastGroups = computed(() => groupCoursesBySemester(pastCourses.value));
const actualSemester = computed(() => {
  const sems = new Set(activeCourses.value.map((c) => c.semester).filter((s): s is string => !!s));
  return sems.size === 1 ? [...sems][0] : null; // subtitle hanya bila seragam
});
const pastCount = computed(() => pastCourses.value.length);

function openCourse(courseId: number) {
  router.push(`/kulon/matakuliah/${courseId}`);
}
async function load() {
  loading.value = true;
  clear();
  try { await store.ensureCourses(); }
  catch (e) { error.value = extract(e); }
  finally { loading.value = false; }
}
async function reloadAfter() { await load(); }
load();
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-28 rounded-card" />
    </div>

    <Alert v-else-if="sessionExpired" class="border-gold/40 bg-gold/20 p-6 text-center">
      <AlertDescription class="font-semibold text-ink">Session login kedaluwarsa</AlertDescription>
      <Button class="mt-3 cursor-pointer" :disabled="auth.checking" @click="relogin(reloadAfter)">
        {{ auth.checking ? 'Memeriksa session…' : 'Login Ulang' }}
      </Button>
    </Alert>

    <Alert v-else-if="error" variant="destructive" class="bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2 cursor-pointer" @click="load">Coba lagi</Button>
    </Alert>

    <div v-else-if="store.courses.length === 0" class="flex flex-col items-center justify-center py-16 text-center bg-card rounded-xl border border-line px-6">
      <p class="font-semibold text-ink text-sm">Belum ada mata kuliah yang diambil</p>
      <p class="text-xs text-ink-muted mt-1">Data akan muncul setelah semester aktif dimulai.</p>
    </div>

    <template v-else>
      <section>
        <div class="mb-3 flex items-baseline gap-2">
          <h2 class="text-base font-bold text-ink">Aktif</h2>
          <span v-if="actualSemester" class="text-xs text-ink-muted">{{ actualSemester }}</span>
        </div>
        <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <CourseCard v-for="c in activeCourses" :key="c.id" :course="c" @open="openCourse(c.id)" />
        </div>
        <p v-if="activeCourses.length === 0" class="text-sm text-ink-muted">Belum ada mata kuliah aktif di semester ini.</p>
      </section>

      <section v-if="pastGroups.length > 0">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-xl border border-line bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
          data-test="expand-past"
          :aria-expanded="pastExpanded"
          @click="pastExpanded = !pastExpanded"
        >
          <div class="flex items-center gap-2">
            <component :is="pastExpanded ? ChevronDown : ChevronRight" class="size-4 text-ink-muted" />
            <span class="font-semibold text-sm text-ink">Mata Kuliah Sebelumnya</span>
            <span class="text-xs font-normal text-ink-muted">({{ pastCount }} mata kuliah)</span>
          </div>
        </button>
        <template v-if="pastExpanded">
          <div v-for="g in pastGroups" :key="g.semester" class="mt-3 space-y-3">
            <h3 :class="['text-sm font-semibold', g.semester === 'Lainnya' ? 'text-ink-muted' : 'text-ink']">
              {{ g.semester === 'Lainnya' ? 'Tanpa semester' : 'Semester ' + g.semester }} ({{ g.courses.length }})
            </h3>
            <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              <CourseCard v-for="c in g.courses" :key="c.id" :course="c" @open="openCourse(c.id)" />
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>