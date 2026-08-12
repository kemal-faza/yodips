<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment, Course } from '../types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import AssignmentCard from './AssignmentCard.vue';
import { ArrowRight } from '@lucide/vue';
import { matchesKulonFilter } from '../utils/assignment';

/* courses defaults to [] so a missed wiring degrades to the empty state
   instead of crashing on `courses.find` inside courseActive(). */
const props = withDefaults(
  defineProps<{
    assignments: Assignment[];
    courses?: Course[];
    loading: boolean;
    hasKulon: boolean;
  }>(),
  { courses: () => [] },
);
const emit = defineEmits<{ open: [Assignment]; 'view-all': [] }>();

const topFour = computed(() =>
  [...props.assignments]
    .filter((a) => matchesKulonFilter('need', a, props.courses))
    .sort((a, b) => (a.duedate || Number.POSITIVE_INFINITY) - (b.duedate || Number.POSITIVE_INFINITY))
    .slice(0, 4),
);
</script>

<template>
  <section class="space-y-4 pt-2" data-test="deadline-section">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-bold text-foreground">Tugas dengan Deadline Terdekat</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">Tugas 'Perlu Dikerjakan' diurutkan berdasarkan tenggat tercepat</p>
      </div>
      <Button variant="ghost" size="sm" class="text-xs font-bold uppercase tracking-wider text-foreground" data-test="view-all-tasks" @click="emit('view-all')">
        Semua Tugas <ArrowRight :size="14" class="ml-1" />
      </Button>
    </div>

    <div v-if="loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Skeleton v-for="i in 4" :key="i" class="h-24 rounded-lg" />
    </div>
    <div v-else-if="!hasKulon" class="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
      Belum ada session Kulon — silakan login ulang via SSO.
    </div>
    <div v-else-if="topFour.length === 0" class="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
      Tidak ada tugas yang perlu dikerjakan.
    </div>
    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <AssignmentCard
        v-for="a in topFour"
        :key="a.id"
        :assignment="a"
        @open="emit('open', a)"
      />
    </div>
  </section>
</template>
