<script setup lang="ts">
import { useFilterStore } from '../stores/filter';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const store = useFilterStore();
</script>

<template>
  <ToggleGroup
    v-model="store.viewMode"
    type="single"
    class="gap-1 rounded-full bg-surface p-1 shadow-sm"
  >
    <ToggleGroupItem
      value="timeline"
      class="!rounded-full px-4 py-1.5 text-sm font-semibold text-ink data-[state=on]:!bg-navy data-[state=on]:text-white"
    >
      Kronologis
    </ToggleGroupItem>
    <ToggleGroupItem
      value="course"
      class="!rounded-full px-4 py-1.5 text-sm font-semibold text-ink data-[state=on]:!bg-navy data-[state=on]:text-white"
    >
      Per Mata Kuliah
    </ToggleGroupItem>
  </ToggleGroup>
</template>
