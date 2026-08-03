<script setup lang="ts">
import { useFilterStore } from '../stores/filter';
import type { Course } from '../types';

defineProps<{ courses: Course[] }>();

const store = useFilterStore();

const statusOptions: { value: string; label: string }[] = [
  { value: 'all', label: 'Semua status' },
  { value: 'overdue', label: 'Terlambat' },
  { value: 'dueSoon', label: 'Segera' },
  { value: 'onTrack', label: 'On track' },
];

const sortOptions: { value: string; label: string }[] = [
  { value: 'deadlineAsc', label: 'Deadline terdekat' },
  { value: 'deadlineDesc', label: 'Deadline terjauh' },
  { value: 'name', label: 'Nama' },
  { value: 'course', label: 'Mata kuliah' },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <input
      v-model="store.search"
      data-test="search"
      type="text"
      placeholder="Cari tugas..."
      class="rounded-full bg-white px-4 py-2 text-sm text-navy shadow-sm outline-none focus:ring-2 focus:ring-gold"
    />
    <select
      v-model="store.status"
      data-test="status"
      class="rounded-full bg-white px-4 py-2 text-sm text-navy shadow-sm outline-none focus:ring-2 focus:ring-gold"
    >
      <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <select
      v-model="store.sortBy"
      data-test="sort"
      class="rounded-full bg-white px-4 py-2 text-sm text-navy shadow-sm outline-none focus:ring-2 focus:ring-gold"
    >
      <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <select
      v-model="store.courseId"
      data-test="course"
      class="rounded-full bg-white px-4 py-2 text-sm text-navy shadow-sm outline-none focus:ring-2 focus:ring-gold"
    >
      <option value="all">Semua mata kuliah</option>
      <option v-for="c in courses" :key="c.id" :value="c.id">
        {{ c.fullname }}
      </option>
    </select>
  </div>
</template>