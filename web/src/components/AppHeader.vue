<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

defineProps<{ showBack?: boolean; breadcrumb?: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const store = useAuthStore();
// Avatar initial from the logged-in identity (NIM in store.user.sub), else 'U'.
const initial = store.user?.sub?.[0]?.toUpperCase() ?? 'U';
</script>

<template>
  <header class="bg-gradient-to-r from-siap-from to-siap-to text-white">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
      <div class="flex items-center gap-3">
        <button
          v-if="showBack"
          class="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium transition hover:bg-white/20"
          @click="emit('back')"
        >
          &larr; Kembali
        </button>
        <div>
          <h1 class="text-lg font-bold">Undip SSO Aggregator</h1>
          <p v-if="breadcrumb" class="text-xs text-white/70">{{ breadcrumb }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
          aria-label="Notifikasi"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 font-bold">
          {{ initial }}
        </div>
        <button
          v-if="store.isAuthenticated"
          class="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium transition hover:bg-white/20"
          @click="store.logout()"
        >
          Keluar
        </button>
      </div>
    </div>
  </header>
</template>
