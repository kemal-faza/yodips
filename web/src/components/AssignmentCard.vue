<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignStatus } from '../utils/assignment';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment }>();

const status = computed(() =>
  assignStatus(props.assignment.overdue, props.assignment.duedate, Date.now()),
);

const formattedDate = computed(() => {
  const d = new Date(props.assignment.duedate * 1000);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
});
</script>

<template>
  <div class="rounded-card bg-white p-4 shadow-sm">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="font-semibold text-navy">{{ assignment.name }}</p>
        <p class="mt-1 text-sm text-navy-light">Deadline: {{ formattedDate }}</p>
      </div>
      <StatusBadge :status="status" />
    </div>
  </div>
</template>