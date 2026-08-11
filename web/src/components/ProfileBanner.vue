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
  <div class="overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-sm [--foreground:white]">
    <div class="flex items-center gap-4 p-6">
      <Avatar class="size-20 border-2 border-primary-foreground/40 bg-primary-foreground/20 text-primary-foreground">
        <AvatarImage v-if="profile?.fotoUrl" :src="profile.fotoUrl" alt="Foto" />
        <AvatarFallback class="bg-transparent text-2xl font-bold">{{ initial(profile?.nama) }}</AvatarFallback>
      </Avatar>
      <div>
        <h1 class="text-xl font-bold">{{ profile?.nama ?? '—' }}</h1>
        <p class="text-sm text-primary-foreground/80">
          NIM {{ profile?.nim ?? '—' }} &middot; {{ profile?.prodi ?? '—' }}
        </p>
      </div>
    </div>
    <Tabs v-model="activeTabModel">
      <TabsList variant="line" class="grid w-full grid-cols-3 border-t border-white/20 bg-black/10">
        <TabsTrigger
          v-for="t in tabs"
          :key="t.key"
          :value="t.key"
          class="dark:text-white/70"
        >
          {{ t.label }}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
</template>
