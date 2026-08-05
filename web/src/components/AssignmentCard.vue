<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignStatus } from '../utils/assignment';
import { Card, CardContent } from '@/components/ui/card';
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
  <Card
    class="assignment-card cursor-pointer rounded-card border-line bg-surface shadow-sm transition hover:shadow-md"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="flex items-start justify-between gap-3 p-4">
      <div>
        <p class="font-semibold text-ink">{{ assignment.name }}</p>
        <p class="mt-0.5 text-sm text-ink-muted">{{ assignment.course }}</p>
        <p class="mt-1 text-sm text-ink-muted">Deadline: {{ formattedDate }}</p>
      </div>
      <StatusBadge :status="status" />
    </CardContent>
  </Card>
</template>
