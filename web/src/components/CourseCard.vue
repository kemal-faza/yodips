<script setup lang="ts">
import { computed } from 'vue';
import type { Course } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from './StatusBadge.vue';
import { ChevronRight } from '@lucide/vue';

const props = defineProps<{ course: Course }>();
const emit = defineEmits<{ (e: 'open'): void }>();

const status = computed(() =>
  props.course.timelineStatus === 'inprogress'
    ? { label: 'Aktif', tone: 'success' as const }
    : { label: 'Selesai', tone: 'muted' as const },
);
</script>

<template>
  <Card
    class="group cursor-pointer overflow-hidden border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40"
    role="button"
    tabindex="0"
    data-test="course-card"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="flex flex-col px-5 py-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ course.shortname }}</span>
        <StatusBadge :label="status.label" :tone="status.tone" />
      </div>
      <p class="mt-2 truncate font-medium text-sm text-foreground">{{ course.fullname }}</p>
      <p v-if="course.semester" class="mt-1 truncate text-xs text-muted-foreground">{{ course.semester }}</p>
      <p
        v-if="course.lecturer"
        data-test="course-lecturer"
        class="mt-1 truncate text-xs text-muted-foreground"
      >{{ course.lecturer }}</p>
      <div class="mt-2 flex items-center gap-2">
        <template v-if="course.progress != null">
          <div class="flex-1 min-w-0">
            <div class="h-1.5 w-full overflow-hidden bg-muted rounded-full">
              <div class="h-full bg-primary transition-all rounded-full" :style="{ width: course.progress + '%' }" />
            </div>
          </div>
          <span data-test="course-progress" class="text-xs font-semibold text-foreground whitespace-nowrap">{{ course.progress }}%</span>
        </template>
        <span class="ml-auto inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-foreground transition-transform duration-150 group-hover:translate-x-0.5">
          Buka
          <ChevronRight class="size-4" aria-hidden="true" />
        </span>
      </div>
    </CardContent>
  </Card>
</template>
