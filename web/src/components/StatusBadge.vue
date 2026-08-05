<script setup lang="ts">
import { computed } from 'vue';
import type { AssignmentStatus } from '../types';
import { Badge } from '@/components/ui/badge';

const props = defineProps<{ status: AssignmentStatus }>();

const label = computed(() =>
  props.status === 'overdue' ? 'Terlambat' : props.status === 'dueSoon' ? 'Segera' : 'On track',
);

const cls = computed(() => {
  if (props.status === 'overdue') return 'bg-danger/10 text-danger';
  if (props.status === 'dueSoon') return 'bg-gold/20 text-ink';
  return 'bg-success/10 text-success';
});
</script>

<template>
  <Badge :class="cls">
    {{ label }}
  </Badge>
</template>
