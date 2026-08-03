<script setup lang="ts">
import { computed } from 'vue';
import type { AssignmentStatus } from '../types';

const props = defineProps<{ status: AssignmentStatus }>();

const label = computed(() =>
  props.status === 'overdue' ? 'Terlambat' : props.status === 'dueSoon' ? 'Segera' : 'On track',
);

const cls = computed(() => {
  if (props.status === 'overdue') return 'bg-danger/10 text-danger';
  if (props.status === 'dueSoon') return 'bg-gold/20 text-gold';
  return 'bg-success/10 text-success';
});
</script>

<template>
  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" :class="cls">
    {{ label }}
  </span>
</template>