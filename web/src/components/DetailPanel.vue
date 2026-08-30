<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import { useMediaQuery } from '@vueuse/core';
import { X } from '@lucide/vue';
import { getAssignmentDetail } from '../api/client';
import type { Assignment, AssignmentDetail, SubmissionStatus } from '../types';
import { deadlineStatus } from '../utils/assignment';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment | null; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const activeTab = ref<'description' | 'files' | 'submission'>('description');
const isDesktop = useMediaQuery('(min-width: 768px)');
const side = computed(() => (isDesktop.value ? 'right' : 'bottom'));
const detail = ref<AssignmentDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const md = new MarkdownIt({ html: false, linkify: false });
const renderedDescriptionHtml = computed(() =>
  detail.value?.descriptionMarkdown ? md.render(detail.value.descriptionMarkdown) : '',
);

const tabs = [
  { key: 'description', label: 'Deskripsi' },
  { key: 'files', label: 'File' },
  { key: 'submission', label: 'Submission' },
] as const;

const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  not_submitted: 'Belum dikumpulkan',
  submitted: 'Sudah dikumpulkan',
  graded: 'Sudah dinilai',
  unknown: 'Tidak diketahui',
};

const status = computed(() =>
  props.assignment
    ? deadlineStatus(props.assignment.overdue, props.assignment.duedate, Date.now())
    : { label: 'On track', tone: 'success' as const },
);

const deadline = computed(() => {
  if (!props.assignment) return '';
  return new Date(props.assignment.duedate * 1000).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
});

const kulonUrl = computed(() => {
  if (detail.value?.kulonUrl) return detail.value.kulonUrl;
  const cmid = props.assignment?.courseModuleId;
  return cmid
    ? `https://kulon2.undip.ac.id/mod/assign/view.php?id=${cmid}`
    : 'https://kulon2.undip.ac.id/';
});

const submissionDot = computed(() => {
  switch (detail.value?.submission.status) {
    case 'submitted': return 'bg-yellow-400';
    case 'graded': return 'bg-emerald-400';
    case 'not_submitted': return 'bg-white/40';
    default: return 'bg-white/25';
  }
});

const submissionLabel = computed(() =>
  detail.value ? SUBMISSION_LABELS[detail.value.submission.status] : '',
);

const submittedAt = computed(() => {
  const sec = detail.value?.submission.submittedAt;
  if (!sec) return null;
  return new Date(sec * 1000).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
});

const gradeText = computed(() => {
  const g = detail.value?.submission;
  if (!g) return '';
  if (g.grade == null && g.maxGrade == null) return 'Belum dinilai';
  const parts = [g.grade != null ? g.grade : '—', g.maxGrade != null ? g.maxGrade : '—'];
  return parts.join(' / ');
});

async function load() {
  const asg = props.assignment;
  if (!asg?.courseModuleId) return;
  loading.value = true;
  error.value = null;
  const assignmentId = asg.assignmentId ?? asg.id;
  try {
    detail.value = await getAssignmentDetail(assignmentId, asg.courseModuleId);
  } catch (e) {
    detail.value = null;
    const statusCode = (e as { response?: { status?: number } })?.response?.status;
    if (statusCode === 401 || statusCode === 403) {
      error.value = 'Session Kulon kedaluwarsa. Silakan login ulang lewat kartu di dashboard.';
    } else if (statusCode === 404) {
      error.value = 'Detail tugas tidak ditemukan.';
    } else {
      error.value = 'Gagal memuat detail tugas.';
    }
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.assignment] as const,
  ([open, asg]) => {
    if (!open) return;
    activeTab.value = 'description';
    if (asg?.courseModuleId) load();
  },
  { immediate: true },
);
</script>

<template>
  <Sheet :open="props.open" @update:open="(o: boolean) => { if (!o) emit('close') }">
    <SheetContent
      :side="side"
      :show-close-button="false"
      class="w-full gap-0 p-0 data-[side=right]:md:w-[50vw] data-[side=right]:md:max-w-[50vw] data-[side=right]:max-md:max-w-none data-[side=bottom]:max-md:h-[85vh]"
      data-test="detail-panel"
    >
      <SheetHeader v-if="assignment" class="bg-primary p-5 text-primary-foreground">
        <div class="flex items-start justify-between gap-3">
          <SheetTitle class="text-left text-lg font-bold text-primary-foreground">
            <span class="block text-sm font-normal text-primary-foreground/70">{{ assignment.course }}</span>
            {{ assignment.name }}
            <span class="mt-1 block text-sm font-normal text-primary-foreground/70">Deadline: {{ deadline }}</span>
            <span
              v-if="detail"
              class="mt-2 flex items-center gap-1.5 text-sm font-normal text-primary-foreground/85"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="submissionDot"
                aria-hidden="true"
              />
              <span data-test="submission-status">{{ submissionLabel }}</span>
              <template v-if="submittedAt">
                <span aria-hidden="true">·</span>
                <span>Dikumpulkan {{ submittedAt }}</span>
              </template>
            </span>
          </SheetTitle>
          <div class="flex flex-col items-end gap-2">
            <StatusBadge :label="status.label" :tone="status.tone" />
            <Button
              variant="ghost"
              size="icon"
              data-test="close"
              aria-label="Tutup"
              class="text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              @click="emit('close')"
            >
              <X class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SheetHeader>

      <template v-if="assignment?.courseModuleId">
        <!-- min-h-0 pada chain flex: tanpa ini, flex-1 child tidak bisa
             menyusut di bawah kontennya sehingga overflow-y-auto di bawah
             tidak pernah scroll (bug: deskripsi panjang tidak bisa discroll). -->
        <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" class="w-full border-b border-border">
            <TabsTrigger
              v-for="t in tabs"
              :key="t.key"
              data-test="tab"
              :value="t.key"
            >
              {{ t.label }}
            </TabsTrigger>
          </TabsList>

          <div class="min-h-0 flex-1 overflow-y-auto p-5">
            <div v-if="loading" class="flex justify-center py-10" data-test="loading">
              <span class="size-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            </div>

            <div v-else-if="error" class="py-8 text-center">
              <p class="text-sm font-semibold text-danger">{{ error }}</p>
              <Button
                data-test="retry"
                class="mt-4"
                @click="load"
              >
                Coba lagi
              </Button>
            </div>

            <template v-else-if="detail">
              <TabsContent value="description" class="min-h-0">
                <div
                  v-if="renderedDescriptionHtml && renderedDescriptionHtml.trim()"
                  class="text-sm leading-relaxed text-foreground"
                  data-test="description"
                  v-html="renderedDescriptionHtml"
                />
                <p v-else class="text-muted-foreground">Tidak ada deskripsi.</p>
              </TabsContent>

              <TabsContent value="files" class="min-h-0">
                <ul class="space-y-3">
                  <li v-for="f in detail.files" :key="f.url">
                    <a
                      :href="f.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-foreground underline hover:text-gold"
                    >
                      {{ f.name }}
                    </a>
                  </li>
                  <li v-if="detail.files.length === 0" class="text-muted-foreground">Tidak ada file.</li>
                </ul>
              </TabsContent>

              <TabsContent value="submission" class="min-h-0 space-y-3 text-sm">
                <p v-if="submittedAt">
                  <span class="font-semibold text-foreground">Dikumpulkan:</span>
                  {{ submittedAt }}
                </p>
                <p v-if="detail.submission.grade != null || detail.submission.maxGrade != null">
                  <span class="font-semibold text-foreground">Nilai:</span>
                  {{ gradeText }}
                </p>
              </TabsContent>
            </template>
          </div>
        </Tabs>
      </template>

      <div class="border-t border-border p-4">
        <a
          :href="kulonUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 font-semibold text-foreground hover:text-gold"
        >
          Buka di Kulon →
        </a>
      </div>
    </SheetContent>
  </Sheet>
</template>
