// KulonDashboardView — assignment dashboard for the Kulon tab: search,
// pagination, list, and a slide-over detail panel. Mirrors the old
// DashboardView 'tugas' layout (gold session-expired alert with Login
// Ulang, skeleton loading, destructive error alert).
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
import type { Assignment } from '../types';

const PAGE_SIZE = 10;

const store = useKulonStore();
const auth = useAuthStore();
const { sessionExpired, error, extract, relogin, clear } = useKulonSession();

const search = ref('');
const page = ref(1);
const loading = ref(false);
const selected = ref<Assignment | null>(null);
const panelOpen = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = [...store.assignments].sort((a, b) => a.duedate - b.duedate);
  if (!q) return list;
  return list.filter((a) => a.name.toLowerCase().includes(q) || a.course.toLowerCase().includes(q));
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const pageItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

watch(search, () => { page.value = 1; });

async function load() {
  loading.value = true;
  clear();
  try {
    await store.ensureAssignments();
  } catch (e) {
    error.value = extract(e);
  } finally {
    loading.value = false;
  }
}

async function reloadAfter() { await load(); }

function openDetail(a: Assignment) {
  selected.value = a;
  panelOpen.value = true;
}

load();
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Input v-model="search" data-test="search" type="text" placeholder="Cari tugas atau mata kuliah…" class="w-64" />
    </div>

    <div v-if="loading" class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="i in 6" :key="i" class="h-12 rounded-card" />
    </div>

    <Alert v-else-if="sessionExpired" class="mt-4 gap-2 border-gold/40 bg-gold/20 p-6 text-center">
      <AlertTitle class="font-semibold text-ink">Session login kedaluwarsa</AlertTitle>
      <AlertDescription class="text-sm text-ink-muted">{{ error }}</AlertDescription>
      <Button class="mt-4 justify-self-center" :disabled="auth.checking" @click="relogin(reloadAfter)">
        {{ auth.checking ? 'Memeriksa session…' : 'Login Ulang' }}
      </Button>
    </Alert>

    <Alert v-else-if="error" variant="destructive" class="mt-4 bg-danger/10 p-4">
      <AlertDescription>{{ error }}</AlertDescription>
      <Button class="mt-2" @click="load">Coba lagi</Button>
    </Alert>

    <div v-else-if="pageItems.length === 0" class="py-12 text-center text-ink-muted">
      Tidak ada tugas yang cocok
    </div>

    <div v-else class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <AssignmentCard v-for="a in pageItems" :key="a.id" :assignment="a" @open="openDetail(a)" />
    </div>

    <div v-if="pageItems.length > 0 && totalPages > 1" class="mt-3 flex justify-center">
      <PaginationBar :page="page" :total-pages="totalPages" @change="(p) => (page = p)" />
    </div>

    <DetailPanel :assignment="selected" :open="panelOpen" @close="panelOpen = false" />
  </div>
</template>
