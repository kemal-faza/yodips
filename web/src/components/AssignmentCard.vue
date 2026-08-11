<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { assignmentDisplayStatus } from '../utils/assignment';
import { formatRelativeDate } from '../utils/date';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from './StatusBadge.vue';
import { ClipboardList, EyeOff, HelpCircle } from '@lucide/vue';

const props = defineProps<{ assignment: Assignment; showHide?: boolean }>();
const emit = defineEmits<{ open: []; hide: [] }>();

const status = computed(() =>
  assignmentDisplayStatus(
    props.assignment.overdue,
    props.assignment.duedate,
    props.assignment.submissionStatus,
  ),
);

const dateText = computed(() => formatRelativeDate(props.assignment.duedate));

const itemIcon = computed(() =>
  props.assignment.module === 'quiz' ? HelpCircle : ClipboardList,
);
</script>

<template>
  <Card
    class="assignment-card group cursor-pointer overflow-hidden border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="flex items-center gap-5 px-5 py-4">
      <component :is="itemIcon" class="size-6 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium text-sm text-foreground">{{ assignment.name }}</p>
        <p class="mt-1.5 truncate text-xs text-muted-foreground">{{ assignment.course }}</p>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1.5">
        <StatusBadge :label="status.label" :tone="status.tone" />
        <span class="flex items-center gap-2 text-[10px] text-muted-foreground">
          {{ dateText }}
          <button
            v-if="props.showHide"
            type="button"
            class="text-muted-foreground/50 transition-colors hover:text-danger cursor-pointer"
            :aria-label="`Sembunyikan ${assignment.name}`"
            data-test="hide-assignment"
            @click.stop="emit('hide')"
          >
            <EyeOff class="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    </CardContent>
  </Card>
</template>
