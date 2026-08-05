<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const route = useRoute();
const router = useRouter();

const tabs = [
  { value: '/kulon/dashboard', label: 'Dashboard' },
  { value: '/kulon/matakuliah', label: 'Mata Kuliah' },
] as const;

const active = computed({
  get: () => route.path.startsWith('/kulon/matakuliah') ? '/kulon/matakuliah' : '/kulon/dashboard',
  set: (v: string) => router.push(v),
});
</script>

<template>
  <Tabs v-model="active">
    <TabsList variant="line" class="w-full border-b border-line">
      <TabsTrigger v-for="t in tabs" :key="t.value" :value="t.value" data-test="kulon-tab">
        {{ t.label }}
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>
