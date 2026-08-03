<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getAssignments } from '../api/client';
import type { Assignment } from '../types';
import { useAuthStore } from '../stores/auth';
import AppHeader from '../components/AppHeader.vue';
import CourseGroup from '../components/CourseGroup.vue';

const store = useAuthStore();
const assignments = ref<Assignment[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const sessionExpired = ref(false);

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

async function load() {
  loading.value = true;
  error.value = null;
  sessionExpired.value = false;
  try {
    const [a] = await Promise.all([getAssignments()]);
    assignments.value = a;
  } catch (e) {
    error.value = extractError(e);
  } finally {
    loading.value = false;
  }
}

async function relogin() {
  // Smart re-capture: reuse session if still valid, else open browser window.
  await store.login();
  if (store.isAuthenticated) {
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <AppHeader />
    <main class="mx-auto max-w-3xl px-4 py-8">
      <h1 class="text-xl font-bold text-navy">Dashboard Tugas</h1>
      <p class="mt-1 text-sm text-navy-light">Ringkasan tugas dan deadline dari Kulon.</p>

      <div v-if="loading" class="mt-8 space-y-3">
        <div v-for="i in 3" :key="i" class="h-20 animate-pulse rounded-card bg-white" />
      </div>

      <div v-else-if="sessionExpired" class="mt-8 rounded bg-gold/20 p-6 text-center">
        <p class="font-semibold text-navy">Session login kedaluwarsa</p>
        <p class="mt-1 text-sm text-navy-light">{{ error }}</p>
        <button
          class="mt-4 inline-block rounded-full bg-navy px-6 py-2.5 font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          :disabled="store.checking"
          @click="relogin"
        >
          {{ store.checking ? 'Memeriksa session…' : 'Login Ulang' }}
        </button>
        <p v-if="store.checking" class="mt-3 text-sm text-navy-light">
          Memeriksa session SSO. Jika perlu, sebuah jendela browser baru akan terbuka.
        </p>
      </div>

      <p v-else-if="error" class="mt-8 rounded bg-danger/10 p-4 text-danger">{{ error }}</p>

      <div v-else class="mt-6">
        <CourseGroup :assignments="assignments" />
      </div>
    </main>
  </div>
</template>