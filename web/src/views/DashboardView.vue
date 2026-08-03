<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getAssignments, getCourses } from '../api/client';
import type { Assignment } from '../types';
import AppHeader from '../components/AppHeader.vue';
import CourseGroup from '../components/CourseGroup.vue';

const assignments = ref<Assignment[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const [a, c] = await Promise.all([getAssignments(), getCourses()]);
    assignments.value = a;
    // courses fetched for future grouping/metadata; assignments already carry course name
  } catch (e) {
    error.value = 'Gagal memuat data. Pastikan backend berjalan. ' + (e as Error).message;
  } finally {
    loading.value = false;
  }
});
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

      <p v-else-if="error" class="mt-8 rounded bg-danger/10 p-4 text-danger">{{ error }}</p>

      <div v-else class="mt-6">
        <CourseGroup :assignments="assignments" />
      </div>
    </main>
  </div>
</template>