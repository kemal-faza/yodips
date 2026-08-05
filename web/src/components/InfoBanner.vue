<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

defineProps<{ message: string; title?: string }>();
</script>

<template>
  <Alert class="rounded-2xl border-warn/40 bg-warn/10 p-4 text-ink">
    <AlertTitle>{{ title ?? 'Info' }}</AlertTitle>
    <AlertDescription class="mt-0.5 text-ink-muted">{{ message }}</AlertDescription>
  </Alert>
</template>
