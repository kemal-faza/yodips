<script setup lang="ts">
import { computed } from 'vue';
import type { Assignment } from '../types';
import { groupByPeriod } from '../utils/timeline';
import AssignmentCard from './AssignmentCard.vue';

const props = defineProps<{ assignments: Assignment[]; nowMs?: number }>();

const emit = defineEmits<{ 'open-assignment': [item: Assignment] }>();

const groups = computed(() => groupByPeriod(props.assignments, props.nowMs ?? Date.now()));

function open(item: Assignment) {
  emit('open-assignment', item);
}
</script>

<template>
  <div v-if="groups.length === 0" class="py-12 text-center text-ink-muted">
    Belum ada tugas
  </div>
  <div v-else class="space-y-8">
    <section v-for="g in groups" :key="g.key" class="space-y-3">
      <h2 class="text-lg font-bold text-ink">{{ g.label }}</h2>
      <div class="space-y-3">
        <AssignmentCard v-for="a in g.items" :key="a.id" :assignment="a" @open="open(a)" />
      </div>
    </section>
  </div>
</template>
