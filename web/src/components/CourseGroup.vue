<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { groupByCourse } from '../utils/assignment';
import AssignmentCard from './AssignmentCard.vue';

const props = defineProps<{ assignments: Assignment[] }>();

const groups = computed(() => groupByCourse(props.assignments));
</script>

<template>
  <div v-if="groups.length === 0" class="py-12 text-center text-navy-light">
    Belum ada tugas
  </div>
  <div v-else class="space-y-8">
    <section v-for="g in groups" :key="g.courseId" class="space-y-3">
      <h2 class="text-lg font-bold text-navy">{{ g.course }}</h2>
      <div class="space-y-3">
        <AssignmentCard v-for="a in g.items" :key="a.id" :assignment="a" />
      </div>
    </section>
  </div>
</template>