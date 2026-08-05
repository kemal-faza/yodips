<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignStatus } from '../utils/assignment';
import { formatRelativeDate } from '../utils/date';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment }>();
const emit = defineEmits<{ open: [] }>();

const status = computed(() =>
  assignStatus(props.assignment.overdue, props.assignment.duedate, Date.now()),
);

const dateText = computed(() => formatRelativeDate(props.assignment.duedate));

const accent = computed(() => {
  if (status.value === 'overdue') return 'border-l-danger';
  if (status.value === 'dueSoon') return 'border-l-warn';
  return 'border-l-success';
});
</script>

<template>
  <Card
    class="assignment-card cursor-pointer border-solid border-l-4 transition hover:bg-muted/50"
    :class="accent"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="flex items-center justify-between gap-3 py-3">
      <div class="min-w-0">
        <p class="truncate font-medium text-ink">{{ assignment.name }}</p>
        <p class="mt-0.5 truncate text-sm text-ink-muted">{{ assignment.course }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge :status="status" />
        <span class="text-xs text-ink-muted">{{ dateText }}</span>
      </div>
    </CardContent>
  </Card>
</template>
