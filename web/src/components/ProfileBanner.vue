<script setup lang="ts">
import { computed } from 'vue';
import type { SiapProfile } from '../types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type SiapTab = 'dasbor' | 'biodata' | 'notifikasi';

const props = defineProps<{ profile: SiapProfile | null; activeTab: SiapTab }>();
const emit = defineEmits<{ (e: 'change-tab', tab: SiapTab): void }>();

const activeTabModel = computed<SiapTab>({
  get: () => props.activeTab,
  set: (v) => emit('change-tab', v),
});

const tabs: Array<{ key: SiapTab; label: string }> = [
  { key: 'dasbor', label: 'Dasbor' },
  { key: 'biodata', label: 'Biodata' },
  { key: 'notifikasi', label: 'Notifikasi' },
];

function initial(name?: string): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
</script>

<template>
  <div class="overflow-hidden rounded-2xl bg-gradient-to-r from-siap-from to-siap-to text-white shadow-lg">
    <div class="flex items-center gap-4 p-6">
      <Avatar class="size-20 border-2 border-white/40 bg-white/20 text-white">
        <AvatarImage v-if="profile?.fotoUrl" :src="profile.fotoUrl" alt="Foto" />
        <AvatarFallback class="bg-transparent text-2xl font-bold">{{ initial(profile?.nama) }}</AvatarFallback>
      </Avatar>
      <div>
        <h1 class="text-xl font-bold">{{ profile?.nama ?? '—' }}</h1>
        <p class="text-sm text-white/80">
          NIM {{ profile?.nim ?? '—' }} &middot; {{ profile?.prodi ?? '—' }}
        </p>
      </div>
    </div>
    <Tabs v-model="activeTabModel">
      <TabsList class="grid w-full grid-cols-3 gap-0 rounded-none border-t border-white/20 bg-black/10 p-0">
        <TabsTrigger
          v-for="t in tabs"
          :key="t.key"
          :value="t.key"
          class="rounded-none px-4 py-3 text-sm font-medium text-white/70 hover:text-white data-[state=active]:bg-white/20 data-[state=active]:text-white"
        >
          {{ t.label }}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
</template>
