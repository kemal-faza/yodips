<script setup lang="ts">
import type { SiapProfile } from '../types';

export type SiapTab = 'dasbor' | 'biodata' | 'notifikasi';

defineProps<{ profile: SiapProfile | null; activeTab: SiapTab }>();
const emit = defineEmits<{ (e: 'change-tab', tab: SiapTab): void }>();

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
      <img
        v-if="profile?.fotoUrl"
        :src="profile.fotoUrl"
        alt="Foto"
        class="h-20 w-20 rounded-full border-2 border-white/40 object-cover"
      />
      <div
        v-else
        class="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-2xl font-bold"
      >
        {{ initial(profile?.nama) }}
      </div>
      <div>
        <h1 class="text-xl font-bold">{{ profile?.nama ?? '—' }}</h1>
        <p class="text-sm text-white/80">
          NIM {{ profile?.nim ?? '—' }} &middot; {{ profile?.prodi ?? '—' }}
        </p>
      </div>
    </div>
    <div class="flex border-t border-white/20 bg-black/10">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="flex-1 px-4 py-3 text-sm font-medium transition"
        :class="activeTab === t.key ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'"
        @click="emit('change-tab', t.key)"
      >
        {{ t.label }}
      </button>
    </div>
  </div>
</template>
