<script setup lang="ts">
import { useFilterStore } from '../stores/filter';

const store = useFilterStore();
</script>

<template>
  <div class="inline-flex rounded-full bg-surface p-1 shadow-sm">
    <button
      class="rounded-full px-4 py-1.5 text-sm font-semibold transition"
      :class="store.viewMode === 'timeline' ? 'bg-navy text-white' : 'text-ink hover:bg-canvas'"
      @click="store.setViewMode('timeline')"
    >
      Kronologis
    </button>
    <button
      class="rounded-full px-4 py-1.5 text-sm font-semibold transition"
      :class="store.viewMode === 'course' ? 'bg-navy text-white' : 'text-ink hover:bg-canvas'"
      @click="store.setViewMode('course')"
    >
      Per Mata Kuliah
    </button>
  </div>
</template>