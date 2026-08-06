<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignmentDisplayStatus } from '../utils/assignment';
import { formatRelativeDate } from '../utils/date';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ assignment: Assignment }>();
const emit = defineEmits<{ open: [] }>();

const status = computed(() =>
  assignmentDisplayStatus(
    props.assignment.overdue,
    props.assignment.duedate,
    props.assignment.submissionStatus,
  ),
);

const dateText = computed(() => formatRelativeDate(props.assignment.duedate));
</script>

<template>
  <Card
    class="assignment-card cursor-pointer border-transparent transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="flex items-center justify-between gap-3 px-3 py-2">
      <div class="min-w-0">
        <p class="truncate font-medium text-sm text-ink">{{ assignment.name }}</p>
        <p class="mt-0.5 truncate text-xs text-ink-muted">{{ assignment.course }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-0.5">
        <StatusBadge :label="status.label" :tone="status.tone" />
        <span class="text-[10px] text-ink-muted">{{ dateText }}</span>
      </div>
    </CardContent>
  </Card>
</template>
