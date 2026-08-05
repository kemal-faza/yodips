<script setup lang="ts">
import type { Course } from '../types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

defineProps<{ course: Course }>();
const emit = defineEmits<{ (e: 'open'): void }>();
</script>

<template>
  <Card
    class="card-hover cursor-pointer text-left"
    role="button"
    tabindex="0"
    data-test="course-card"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <CardContent class="p-4">
      <Badge v-if="course.semester" class="bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400">
        {{ course.semester }}
      </Badge>
      <p class="mt-2 truncate font-medium text-ink">{{ course.fullname }}</p>
      <p v-if="course.idnumber" class="mt-0.5 truncate text-xs text-ink-muted">{{ course.idnumber }}</p>
    </CardContent>
  </Card>
</template>