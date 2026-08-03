<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignStatus } from '../utils/assignment';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment }>();

const emit = defineEmits<{ open: [] }>();

const status = computed(() =>
  assignStatus(props.assignment.overdue, props.assignment.duedate, Date.now()),
);

const formattedDate = computed(() => {
  const d = new Date(props.assignment.duedate * 1000);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
});
</script>

<template>
  <div
    class="assignment-card cursor-pointer rounded-card bg-white p-4 shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gold"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="font-semibold text-navy">{{ assignment.name }}</p>
        <p class="mt-0.5 text-sm text-navy-light">{{ assignment.course }}</p>
        <p class="mt-1 text-sm text-navy-light">Deadline: {{ formattedDate }}</p>
      </div>
      <StatusBadge :status="status" />
    </div>
  </div>
</template>