<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const route = useRoute();
const router = useRouter();

const tabs = [
  { value: '/kulon/dashboard', label: 'Dashboard' },
  { value: '/kulon/matakuliah', label: 'Mata Kuliah' },
] as const;

const active = computed(() =>
  route.path.startsWith('/kulon/matakuliah') ? '/kulon/matakuliah' : '/kulon/dashboard',
);

function select(v: string) {
  router.push(v);
}
</script>

<template>
  <Tabs :value="active" @update:model-value="(v) => select(v as string)">
    <TabsList variant="line" class="w-full border-b border-line">
      <TabsTrigger v-for="t in tabs" :key="t.value" :value="t.value" data-test="kulon-tab">
        {{ t.label }}
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>
