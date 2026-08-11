<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

defineProps<{ message: string; title?: string }>();
</script>

<template>
  <Alert class="border-warn/40 bg-warn/10 p-4">
    <AlertTitle>{{ title ?? 'Info' }}</AlertTitle>
    <AlertDescription class="mt-0.5 text-muted-foreground">{{ message }}</AlertDescription>
  </Alert>
</template>
