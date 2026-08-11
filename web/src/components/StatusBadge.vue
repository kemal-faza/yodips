<script setup lang="ts">
import { computed } from 'vue';
import type { DisplayTone } from '../utils/assignment';
import { Badge } from '@/components/ui/badge';

const props = defineProps<{ label: string; tone: DisplayTone }>();

const cls = computed(() => {
  if (props.tone === 'danger') return 'bg-danger/10 text-danger-foreground';
  if (props.tone === 'warn') return 'bg-gold/20 text-foreground';
  if (props.tone === 'success') return 'bg-success/10 text-success';
  return 'bg-foreground/5 text-muted-foreground';
});

const dot = computed(() => {
  if (props.tone === 'danger') return 'bg-danger';
  if (props.tone === 'warn') return 'bg-warn';
  if (props.tone === 'success') return 'bg-success';
  return 'bg-muted-foreground';
});
</script>

<template>
  <Badge class="gap-1.5" :class="cls">
    <span class="size-1.5 rounded-full" :class="dot"></span>
    {{ label }}
  </Badge>
</template>
