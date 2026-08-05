<script setup lang="ts">
import { computed } from 'vue';
import { useFilterStore } from '../stores/filter';
import type { Course } from '../types';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const props = defineProps<{ courses: Course[] }>();

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

const statusLabel = computed(
  () => statusOptions.find((o) => o.value === store.status)?.label ?? 'Semua status',
);
const sortLabel = computed(
  () => sortOptions.find((o) => o.value === store.sortBy)?.label ?? 'Deadline terdekat',
);
const courseLabel = computed(() => {
  if (store.courseId === 'all') return 'Semua mata kuliah';
  return props.courses.find((c) => c.id === store.courseId)?.fullname ?? 'Semua mata kuliah';
});

function onCourseChange(v: unknown) {
  store.setCourseId(v === 'all' || v == null ? 'all' : Number(v));
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Input
      v-model="store.search"
      data-test="search"
      type="text"
      placeholder="Cari tugas..."
      class="h-9 w-48 rounded-full bg-surface px-4 text-sm text-ink shadow-sm"
    />
    <Select v-model="store.status">
      <SelectTrigger
        data-test="status"
        aria-label="Filter status"
        class="h-9 w-44 rounded-full bg-surface px-4 py-0 text-sm text-ink shadow-sm"
      >
        <SelectValue>{{ statusLabel }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <Select v-model="store.sortBy">
      <SelectTrigger
        data-test="sort"
        aria-label="Urutkan"
        class="h-9 w-48 rounded-full bg-surface px-4 py-0 text-sm text-ink shadow-sm"
      >
        <SelectValue>{{ sortLabel }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <Select :model-value="String(store.courseId)" @update:model-value="onCourseChange">
      <SelectTrigger
        data-test="course"
        aria-label="Filter mata kuliah"
        class="h-9 max-w-56 rounded-full bg-surface px-4 py-0 text-sm text-ink shadow-sm"
      >
        <SelectValue>{{ courseLabel }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Semua mata kuliah</SelectItem>
        <SelectItem v-for="c in courses" :key="c.id" :value="String(c.id)">
          {{ c.fullname }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
