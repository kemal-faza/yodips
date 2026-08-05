<script setup lang="ts">
import { useFilterStore } from '../stores/filter';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const store = useFilterStore();
</script>

<template>
  <ToggleGroup
    v-model="store.viewMode"
    type="single"
    class="bg-muted rounded-lg p-0.5"
  >
    <ToggleGroupItem
      value="timeline"
      class="data-[state=on]:bg-navy data-[state=on]:text-white"
    >
      Kronologis
    </ToggleGroupItem>
    <ToggleGroupItem
      value="course"
      class="data-[state=on]:bg-navy data-[state=on]:text-white"
    >
      Per Mata Kuliah
    </ToggleGroupItem>
  </ToggleGroup>
</template>
