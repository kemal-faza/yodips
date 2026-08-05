<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useKulonStore } from '../stores/kulon';
import { useKulonSession } from '../composables/useKulonSession';
import DetailPanel from '../components/DetailPanel.vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ClipboardList, HelpCircle, Link, Megaphone, FileQuestion } from '@lucide/vue';
import type { CourseContentItem, Assignment } from '../types';

const route = useRoute();
const store = useKulonStore();
const { sessionExpired, error, extract, clear } = useKulonSession();
const loading = ref(false);
const selected = ref<Assignment | null>(null);
const panelOpen = ref(false);

const courseId = computed(() => Number(route.params.courseId));
const content = computed(() => store.contents.get(courseId.value));
const course = computed(() => store.courses.find((c) => c.id === courseId.value));

const ITEM_ICON = { file: FileText, assign: ClipboardList, quiz: HelpCircle, url: Link, forum: Megaphone, page: FileText, other: FileQuestion };

function itemIcon(kind: CourseContentItem['kind']) {
  return ITEM_ICON[kind] ?? FileQuestion;
}

function openItem(item: CourseContentItem) {
  if (item.kind === 'assign' && item.cmid) {
    selected.value = {
      id: item.cmid, name: item.name, module: 'assign', eventType: 'due',
      duedate: item.duedate ?? 0, overdue: item.duedate ? item.duedate * 1000 < Date.now() : false,
      course: course.value?.fullname ?? '', courseId: courseId.value,
      assignmentId: item.assignmentId, courseModuleId: item.cmid,
    };
    panelOpen.value = true;
  } else if (item.url) {
    window.open(item.url, '_blank', 'noopener,noreferrer');
  }
}

async function load() {
  loading.value = true;
  clear();
  try {
    // ensureCourses untuk nama matkul; kegagalannya tidak boleh memblokir konten.
    await store.ensureCourses().catch(() => undefined);
    await store.ensureContent(courseId.value);
  } catch (e) {
    error.value = extract(e);
  } finally {
    loading.value = false;
  }
}
load();
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 4" :key="i" class="h-20 rounded-card" />
    </div>

    <Alert v-else-if="sessionExpired" class="border-gold/40 bg-gold/20 p-6 text-center">
      <AlertDescription class="font-semibold text-ink">Session login kedaluwarsa</AlertDescription>
    </Alert>

    <Alert v-else-if="error" variant="destructive" class="bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2" @click="load">Coba lagi</Button>
    </Alert>

    <div v-else-if="!content" class="py-12 text-center text-ink-muted">Mata kuliah tidak ditemukan.</div>

    <div v-else class="space-y-6">
      <h1 class="text-xl font-bold text-ink">{{ course?.fullname ?? 'Mata Kuliah' }}</h1>

      <section v-for="s in content.sections" :key="s.id" class="space-y-2">
        <div class="flex items-baseline gap-2">
          <h2 class="text-lg font-bold text-ink">{{ s.label }}</h2>
          <span v-if="s.dateRange" class="text-sm text-ink-muted">{{ s.dateRange }}</span>
        </div>

        <div v-if="s.items.length === 0" class="text-sm text-ink-muted">Tidak ada materi</div>

        <ul class="space-y-2">
          <li v-for="item in s.items" :key="item.cmid ?? item.url">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left hover:bg-muted/50"
              :data-test="`item-${item.kind}-${item.cmid}`"
              @click="openItem(item)"
            >
              <component :is="itemIcon(item.kind)" class="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ item.name }}</span>
              <span v-if="item.kind === 'file' && item.fileType" class="shrink-0 text-xs uppercase text-ink-muted">
                {{ item.fileType }}
              </span>
              <span v-else-if="item.kind === 'assign'" class="shrink-0 text-xs uppercase text-ink-muted">Tugas</span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <DetailPanel :assignment="selected" :open="panelOpen" @close="panelOpen = false" />
  </div>
</template>