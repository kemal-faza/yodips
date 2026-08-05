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

const store = useKulonStore();
const auth = useAuthStore();
const router = useRouter();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();
const loading = ref(false);
const expandedSemesters = ref<Set<string>>(new Set());

const groups = computed(() => groupCoursesBySemester(store.courses));
const current = computed(() => groups.value[0]);
const past = computed(() => groups.value.slice(1));
const activeSemester = computed(() => current.value?.semester);

function isExpanded(semester: string) {
  return expandedSemesters.value.has(semester);
}
function toggle(semester: string) {
  const next = new Set(expandedSemesters.value);
  if (next.has(semester)) next.delete(semester); else next.add(semester);
  expandedSemesters.value = next;
}
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
  <div>
    <div v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-28 rounded-card" />
    </div>

    <Alert v-else-if="sessionExpired" class="border-gold/40 bg-gold/20 p-6 text-center">
      <AlertDescription class="font-semibold text-ink">Session login kedaluwarsa</AlertDescription>
      <Button class="mt-3" :disabled="auth.checking" @click="relogin(reloadAfter)">
        {{ auth.checking ? 'Memeriksa session…' : 'Login Ulang' }}
      </Button>
    </Alert>

    <Alert v-else-if="error" variant="destructive" class="bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2" @click="load">Coba lagi</Button>
    </Alert>

    <div v-else-if="store.courses.length === 0" class="py-12 text-center text-ink-muted">
      Belum ada mata kuliah yang diambil
    </div>

    <template v-else>
      <h2 class="mb-3 text-lg font-bold text-ink">{{ activeSemester ?? 'Semester aktif' }}</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CourseCard v-for="c in current?.courses ?? []" :key="c.id" :course="c" @open="openCourse(c.id)" />
      </div>

      <div v-for="g in past" :key="g.semester" class="mt-8">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg border border-line px-4 py-3 text-left hover:bg-muted/50"
          data-test="expand-past"
          @click="toggle(g.semester)"
        >
          <span class="font-semibold text-ink">Semester {{ g.semester }} ({{ g.courses.length }})</span>
          <span>{{ isExpanded(g.semester) ? '–' : '+' }}</span>
        </button>
        <div v-if="isExpanded(g.semester)" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CourseCard v-for="c in g.courses" :key="c.id" :course="c" @open="openCourse(c.id)" />
        </div>
      </div>
    </template>
  </div>
</template>