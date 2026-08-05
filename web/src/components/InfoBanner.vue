<script setup lang="ts">
defineProps<{ message: string; title?: string }>();
</script>

<template>
  <div class="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
    <p class="font-semibold text-navy">{{ title ?? 'Info' }}</p>
    <p class="mt-0.5 text-navy-light">{{ message }}</p>
  </div>
</template>
