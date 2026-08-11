<script setup lang="ts">
import type { Course } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen } from '@lucide/vue';

defineProps<{ course: Course }>();
const emit = defineEmits<{ (e: 'open'): void }>();
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
    <CardContent class="flex items-center gap-5 px-5 py-4">
      <BookOpen class="size-6 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium text-sm text-foreground">{{ course.fullname }}</p>
        <p v-if="course.idnumber" class="mt-1.5 truncate text-xs text-muted-foreground">{{ course.idnumber }}</p>
      </div>
    </CardContent>
  </Card>
</template>