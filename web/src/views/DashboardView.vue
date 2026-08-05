<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAssignments, getCourses, getSiapProfile } from '../api/client';
import type { Assignment, Course, SiapProfile } from '../types';
import { useAuthStore } from '../stores/auth';
import { useFilterStore } from '../stores/filter';
import { applyFilters, applySort } from '../utils/filter';
import AppHeader from '../components/AppHeader.vue';
import FilterBar from '../components/FilterBar.vue';
import ViewToggle from '../components/ViewToggle.vue';
import TimelineGroup from '../components/TimelineGroup.vue';
import CourseGroup from '../components/CourseGroup.vue';
import DetailPanel from '../components/DetailPanel.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import SsoDashboard from '../components/SsoDashboard.vue';
import ProfileBanner, { type SiapTab } from '../components/ProfileBanner.vue';
import InfoBanner from '../components/InfoBanner.vue';
import SiapDashboard from '../components/SiapDashboard.vue';
import SiapBiodata from '../components/SiapBiodata.vue';
import SiapNotifikasi from '../components/SiapNotifikasi.vue';

type SiapView = 'sso' | 'siap' | 'tugas';

const store = useAuthStore();
const filterStore = useFilterStore();

const activeView = ref<SiapView>('sso');
const siapTab = ref<SiapTab>('dasbor');
const profile = ref<SiapProfile | null>(null);
const profileError = ref<string | null>(null);
const hasSiap = computed(() => store.hasSiap);

const assignments = ref<Assignment[]>([]);
const courses = ref<Course[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const sessionExpired = ref(false);
const tugasLoaded = ref(false);
const selected = ref<Assignment | null>(null);
const panelOpen = ref(false);

const visible = computed(() =>
  applySort(
    applyFilters(
      assignments.value,
      { search: filterStore.search, status: filterStore.status, courseId: filterStore.courseId },
      Date.now(),
    ),
    filterStore.sortBy,
  ),
);

const headerTitle = computed(() => {
  if (activeView.value === 'siap') return 'SIAP';
  if (activeView.value === 'tugas') return 'Online Courses';
  return '';
});

function extractError(e: unknown): string {
  const anyE = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = anyE.response?.status;
  const serverMsg = anyE.response?.data?.message;
  if (status === 401 || status === 403) {
    sessionExpired.value = true;
    return serverMsg || 'Session login kedaluwarsa — silakan login ulang.';
  }
  if (serverMsg) return serverMsg;
  return anyE.message || 'Terjadi kesalahan tidak diketahui.';
}

async function loadProfile() {
  profileError.value = null;
  try {
    profile.value = await getSiapProfile();
  } catch (e) {
    profileError.value = extractError(e);
  }
}

async function loadTugas() {
  loading.value = true;
  error.value = null;
  sessionExpired.value = false;
  try {
    const [a, c] = await Promise.all([getAssignments(), getCourses()]);
    assignments.value = a;
    courses.value = c;
  } catch (e) {
    error.value = extractError(e);
  } finally {
    loading.value = false;
  }
}

function navigate(view: SiapView) {
  if (view === 'tugas' && !tugasLoaded.value) {
    tugasLoaded.value = true;
    loadTugas();
  }
  if (view === 'siap' && !profile.value && hasSiap.value) {
    loadProfile();
  }
  activeView.value = view;
}

async function relogin() {
  // Smart re-capture: reuse session if still valid, else open browser window.
  await store.login();
  if (store.isAuthenticated) {
    await loadTugas();
  }
}

function changeSiapTab(tab: SiapTab) {
  siapTab.value = tab;
}

function openDetail(a: Assignment) {
  selected.value = a;
  panelOpen.value = true;
}

onMounted(() => {
  if (hasSiap.value) loadProfile();
});
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <AppHeader
      :show-back="activeView !== 'sso'"
      :breadcrumb="headerTitle"
      @back="navigate('sso')"
    />
    <main class="mx-auto max-w-6xl px-4 py-8">
      <SsoDashboard v-if="activeView === 'sso'" @navigate="navigate" />

      <div v-else-if="activeView === 'siap'" class="space-y-4">
        <template v-if="hasSiap">
          <ProfileBanner :profile="profile" :active-tab="siapTab" @change-tab="changeSiapTab" />
          <InfoBanner message="Ringkasan akademik dan biodata Anda dari SIAP Undip." />
          <div v-if="profileError" class="rounded-2xl bg-danger/10 p-4 text-danger">
            {{ profileError }}
          </div>
          <SiapDashboard v-if="siapTab === 'dasbor'" :profile="profile" :has-siap="hasSiap" />
          <SiapBiodata v-else-if="siapTab === 'biodata'" :profile="profile" />
          <SiapNotifikasi v-else />
        </template>
        <Card v-else class="rounded-2xl border-line bg-surface p-8 text-center">
          <CardContent class="p-0">
            <p class="font-semibold text-ink">Belum ada session SIAP</p>
            <p class="mt-1 text-sm text-ink-muted">
              Silakan login ulang via SSO untuk melihat data akademik.
            </p>
          </CardContent>
        </Card>
      </div>

      <div v-else>
        <div v-if="loading" class="mt-4 space-y-3">
          <Skeleton v-for="i in 3" :key="i" class="h-20 rounded-card" />
        </div>

        <div v-else-if="sessionExpired" class="mt-4 rounded bg-gold/20 p-6 text-center">
          <p class="font-semibold text-ink">Session login kedaluwarsa</p>
          <p class="mt-1 text-sm text-ink-muted">{{ error }}</p>
          <Button
            class="mt-4 inline-block rounded-full bg-navy px-6 py-2.5 font-semibold text-white hover:bg-navy-light disabled:opacity-50"
            :disabled="store.checking"
            @click="relogin"
          >
            {{ store.checking ? 'Memeriksa session…' : 'Login Ulang' }}
          </Button>
          <p v-if="store.checking" class="mt-3 text-sm text-ink-muted">
            Memeriksa session SSO. Jika perlu, sebuah jendela browser baru akan terbuka.
          </p>
        </div>

        <p v-else-if="error" class="mt-4 rounded bg-danger/10 p-4 text-danger">{{ error }}</p>

        <div v-else class="mt-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <FilterBar :courses="courses" />
            <ViewToggle />
          </div>
          <div class="mt-6">
            <TimelineGroup
              v-if="filterStore.viewMode === 'timeline'"
              :assignments="visible"
              @open-assignment="openDetail"
            />
            <CourseGroup v-else :assignments="visible" />
          </div>
        </div>
      </div>
    </main>

    <DetailPanel :assignment="selected" :open="panelOpen" @close="panelOpen = false" />
  </div>
</template>
