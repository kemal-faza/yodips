<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useKulonStore } from '../stores/kulon';
import { useAuthStore } from '../stores/auth';
import { useKulonSession } from '../composables/useKulonSession';
import { isCacheStaleError } from '../api/cache';
import DetailPanel from '../components/DetailPanel.vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileText,
  ClipboardList,
  HelpCircle,
  Link,
  Megaphone,
  FileQuestion,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Calendar,
} from '@lucide/vue';
import type { CourseContentItem, Assignment, CourseSection, KulonCourseContent } from '../types';

const route = useRoute();
const router = useRouter();
const store = useKulonStore();
const auth = useAuthStore();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();

const loading = ref(false);
const selected = ref<Assignment | null>(null);
const panelOpen = ref(false);
const collapsedSections = ref<Record<number, boolean>>({});

const courseId = computed(() => Number(route.params.courseId));
const content = ref<KulonCourseContent | null>(null);
const course = computed(() => store.courses.find((c) => c.id === courseId.value));

const ITEM_ICON = {
  file: FileText,
  assign: ClipboardList,
  quiz: HelpCircle,
  url: Link,
  forum: Megaphone,
  page: FileText,
  other: FileQuestion,
};

const KIND_LABEL: Record<CourseContentItem['kind'], string> = {
  file: '',
  assign: 'Tugas',
  quiz: 'Kuis',
  url: 'Link',
  forum: 'Forum',
  page: 'Materi',
  other: '',
};

function itemIcon(kind: CourseContentItem['kind']) {
  return ITEM_ICON[kind] ?? FileQuestion;
}

function itemBadge(item: CourseContentItem): string {
  if (item.kind === 'file') {
    // JSON course content (core_courseformat_get_state) provides no file type, so
    // fileType is 'other' — hide the badge rather than show a noisy "OTHER".
    return item.fileType && item.fileType !== 'other' ? item.fileType : '';
  }
  return KIND_LABEL[item.kind] ?? '';
}

const MONTH_NAMES: Record<string, number> = {
  // Indonesian
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, agu: 7, ags: 7,
  september: 8, sep: 8,
  oktober: 9, okt: 9,
  november: 10, nov: 10,
  desember: 11, des: 11,
  // English (Kulon real titles use e.g. "9 February - 15 February").
  // april/september/november are identical to the Indonesian keys above.
  january: 0,
  february: 1,
  march: 2,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  october: 9,
  december: 11,
};

/**
 * Checks if a section's date range corresponds to the current week.
 * Example dateRange: "18 Februari - 24 Februari 2026"
 */
function isCurrentWeekSection(dateRange?: string): boolean {
  if (!dateRange) return false;
  try {
    const parts = dateRange.trim().toLowerCase().split(/\s*-\s*/);
    if (parts.length < 2) return false;
    
    // Extract year if available at the end
    const yearMatch = dateRange.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    const startTokens = parts[0].trim().split(/\s+/);
    const endTokens = parts[1].trim().split(/\s+/);

    const startDay = parseInt(startTokens[0], 10);
    const startMonthStr = startTokens[1] || '';

    const endDay = parseInt(endTokens[0], 10);
    const endMonthStr = endTokens[1] || startMonthStr;

    if (isNaN(startDay) || isNaN(endDay)) return false;
    // BUGFIX: both months must be recognized. The old `?? new Date().getMonth()`
    // fallback silently re-placed EVERY unrecognized day-range into the current
    // month — so several weekly titles whose day-numbers straddled today all got
    // flagged "Minggu Ini" at once (e.g. Pertemuan 7 AND 15). Unknown month ⇒ not
    // a valid current-week section.
    if (!(startMonthStr in MONTH_NAMES) || !(endMonthStr in MONTH_NAMES)) return false;

    const startMonth = MONTH_NAMES[startMonthStr];
    const endMonth = MONTH_NAMES[endMonthStr];

    const now = new Date();
    const startDate = new Date(year, startMonth, startDay, 0, 0, 0);
    const endDate = new Date(year, endMonth, endDay, 23, 59, 59);

    return now >= startDate && now <= endDate;
  } catch {
    return false;
  }
}

function initializeSectionCollapse(sections: CourseSection[]) {
  const initial: Record<number, boolean> = {};
  let foundCurrentWeek = false;

  sections.forEach((s) => {
    const isCurrent = isCurrentWeekSection(s.dateRange);
    if (isCurrent) foundCurrentWeek = true;
    // Default collapsed (true) EXCEPT for section matching current week
    initial[s.id] = !isCurrent;
  });

  // If no section matched current week, keep section 0 or 1 uncollapsed as fallback
  if (!foundCurrentWeek && sections.length > 0) {
    // If all collapsed, keep the last non-empty section or section 1 open
    const targetSection = sections.find((s) => s.items.length > 0) ?? sections[0];
    if (targetSection) {
      initial[targetSection.id] = false;
    }
  }

  collapsedSections.value = initial;
}

watch(
  content,
  (newContent) => {
    if (newContent?.sections) {
      initializeSectionCollapse(newContent.sections);
    }
  },
  { immediate: true },
);

function isCollapsed(sectionId: number): boolean {
  return collapsedSections.value[sectionId] ?? true;
}

function toggleSection(sectionId: number) {
  collapsedSections.value[sectionId] = !isCollapsed(sectionId);
}

function openItem(item: CourseContentItem) {
  if (item.kind === 'assign' && item.cmid) {
    selected.value = {
      id: item.cmid,
      name: item.name,
      module: 'assign',
      eventType: 'due',
      duedate: item.duedate ?? 0,
      overdue: item.duedate ? item.duedate * 1000 < Date.now() : false,
      course: course.value?.fullname ?? '',
      courseId: courseId.value,
      assignmentId: item.assignmentId,
      courseModuleId: item.cmid,
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
    await store.ensureCourses().catch(() => undefined);
    content.value = await store.ensureContent(courseId.value);
  } catch (e) {
    if (isCacheStaleError(e)) return;
    error.value = extract(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.params.courseId,
  () => {
    content.value = null;
    load();
  },
);

load();
</script>

<template>
  <div class="space-y-4">
    <!-- Header with Back Button -->
    <div class="flex items-center gap-3">
      <Button
        variant="outline"
        size="icon"
        class="size-9 shrink-0 cursor-pointer"
        aria-label="Kembali ke Mata Kuliah"
        data-test="back-button"
        @click="router.push('/kulon/matakuliah')"
      >
        <ArrowLeft class="size-4" aria-hidden="true" />
      </Button>
      <div class="min-w-0">
        <h1 class="text-lg font-bold text-foreground truncate leading-tight">
          {{ course?.fullname ?? 'Detail Mata Kuliah' }}
        </h1>
        <p v-if="course?.semester" class="text-xs text-muted-foreground">
          {{ course.semester }}
        </p>
      </div>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 4" :key="i" class="h-16 rounded-lg" />
    </div>

    <!-- Session Expired Alert -->
    <Alert v-else-if="sessionExpired" class="border-gold/40 bg-gold/20 p-6 text-center">
      <AlertDescription class="font-semibold text-foreground">Session login kedaluwarsa</AlertDescription>
      <Button class="mt-3 cursor-pointer" :disabled="auth.checking" @click="relogin">
        {{ auth.checking ? 'Memeriksa session…' : 'Login Ulang' }}
      </Button>
    </Alert>

    <!-- Error Alert -->
    <Alert v-else-if="error" variant="destructive" class="bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2 cursor-pointer" @click="load">Coba lagi</Button>
    </Alert>

    <!-- Content Empty -->
    <div v-else-if="!content" class="py-16 text-center text-muted-foreground bg-card rounded-xl border border-border p-6">
      Mata kuliah tidak ditemukan.
    </div>

    <!-- Sections Accordion -->
    <div v-else class="space-y-3">
      <section
        v-for="s in content.sections"
        :key="s.id"
        class="rounded-xl border border-border bg-card overflow-hidden transition-colors"
      >
        <!-- Section Toggle Header -->
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
          :data-test="`section-toggle-${s.id}`"
          @click="toggleSection(s.id)"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <component
              :is="isCollapsed(s.id) ? ChevronRight : ChevronDown"
              class="size-4 shrink-0 text-muted-foreground transition-transform"
              aria-hidden="true"
            />
            <h2 class="text-sm font-semibold text-foreground truncate">{{ s.label }}</h2>
            <span
              v-if="isCurrentWeekSection(s.dateRange)"
              class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-muted-foreground dark:bg-primary/20"
            >
              Minggu Ini
            </span>
          </div>

          <span v-if="s.dateRange" class="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Calendar class="size-3" />
            {{ s.dateRange }}
          </span>
        </button>

        <!-- Section Content (Items) -->
        <div v-if="!isCollapsed(s.id)" class="border-t border-border/60 bg-muted/10 px-3 py-2.5">
          <div v-if="s.items.length === 0" class="px-2 py-3 text-xs text-muted-foreground italic">
            Tidak ada materi pada pertemuan ini.
          </div>

          <ul v-else class="space-y-1.5">
            <li v-for="item in s.items" :key="item.cmid ?? item.url">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2 text-left transition-all hover:border-primary/40 hover:bg-muted/30 hover:shadow-2xs cursor-pointer"
                :data-test="`item-${item.kind}-${item.cmid}`"
                @click="openItem(item)"
              >
                <component :is="itemIcon(item.kind)" class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{{ item.name }}</span>
                <span v-if="itemBadge(item)" class="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {{ itemBadge(item) }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <!-- Assignment Detail Side Sheet -->
    <DetailPanel :assignment="selected" :open="panelOpen" @close="panelOpen = false" />
  </div>
</template>
