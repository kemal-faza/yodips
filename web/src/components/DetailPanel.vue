<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getAssignmentDetail } from '../api/client';
import type { Assignment, AssignmentDetail, SubmissionStatus } from '../types';
import { assignStatus } from '../utils/assignment';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment | null; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const activeTab = ref<'description' | 'files' | 'submission'>('description');
const detail = ref<AssignmentDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

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
    ? assignStatus(props.assignment.overdue, props.assignment.duedate, Date.now())
    : 'onTrack',
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
      error.value = 'Session Kulon kedaluwarsa — login ulang lewat kartu di dashboard.';
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
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        data-test="detail-panel"
      >
        <div
          class="absolute inset-0 bg-navy/60 backdrop-blur-sm"
          data-test="backdrop"
          @click="emit('close')"
        />
        <aside class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
          <header v-if="assignment" class="bg-navy p-5 text-white">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm text-white/70">{{ assignment.course }}</p>
                <h2 class="mt-1 text-lg font-bold">{{ assignment.name }}</h2>
                <p class="mt-1 text-sm text-white/70">Deadline: {{ deadline }}</p>
              </div>
              <div class="flex flex-col items-end gap-2">
                <StatusBadge :status="status" />
                <button
                  data-test="close"
                  aria-label="Tutup"
                  class="rounded-full p-2 leading-none text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-gold"
                  @click="emit('close')"
                >
                  ✕
                </button>
              </div>
            </div>
          </header>

          <template v-if="assignment?.courseModuleId">
            <div class="flex border-b border-canvas">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                data-test="tab"
                class="flex-1 px-4 py-2.5 text-sm font-semibold transition"
                :class="
                  activeTab === tab.key
                    ? 'border-b-2 border-gold text-navy'
                    : 'text-navy-light hover:text-navy'
                "
                @click="activeTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-5">
              <div v-if="loading" class="flex justify-center py-10" data-test="loading">
                <span
                  class="size-6 animate-spin rounded-full border-2 border-gold border-t-transparent"
                />
              </div>

              <div v-else-if="error" class="py-8 text-center">
                <p class="text-sm font-semibold text-danger">{{ error }}</p>
                <button
                  data-test="retry"
                  class="mt-4 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-light focus:outline-none focus:ring-2 focus:ring-gold"
                  @click="load"
                >
                  Coba lagi
                </button>
              </div>

              <template v-else-if="detail">
                <div v-if="activeTab === 'description'">
                  <div
                    v-if="detail.descriptionHtml"
                    class="text-sm leading-relaxed text-navy"
                    v-html="detail.descriptionHtml"
                  />
                  <p v-else class="text-navy-light">Tidak ada deskripsi.</p>
                </div>

                <ul v-else-if="activeTab === 'files'" class="space-y-3">
                  <li v-for="f in detail.files" :key="f.url">
                    <a
                      :href="f.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-navy underline hover:text-gold"
                    >
                      {{ f.name }}
                    </a>
                  </li>
                  <li v-if="detail.files.length === 0" class="text-navy-light">Tidak ada file.</li>
                </ul>

                <div v-else class="space-y-3 text-sm">
                  <p>
                    <span class="font-semibold text-navy">Status:</span>
                    {{ submissionLabel }}
                  </p>
                  <p v-if="submittedAt">
                    <span class="font-semibold text-navy">Dikumpulkan:</span>
                    {{ submittedAt }}
                  </p>
                  <p v-if="detail.submission.grade != null || detail.submission.maxGrade != null">
                    <span class="font-semibold text-navy">Nilai:</span>
                    {{ gradeText }}
                  </p>
                </div>
              </template>
            </div>
          </template>

          <footer class="border-t border-canvas p-4">
            <a
              :href="kulonUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-semibold text-navy hover:text-gold"
            >
              Buka di Kulon →
            </a>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>