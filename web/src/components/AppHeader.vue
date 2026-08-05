<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

defineProps<{ showBack?: boolean; breadcrumb?: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const store = useAuthStore();
const theme = useThemeStore();
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
          :aria-label="theme.dark ? 'Pindah ke tema terang' : 'Pindah ke tema gelap'"
          data-test="theme-toggle"
          @click="theme.toggle()"
        >
          <svg
            v-if="theme.dark"
            class="h-4 w-4"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          <svg
            v-else
            class="h-4 w-4"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>
        <button
          class="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
          aria-label="Notifikasi"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <Avatar class="size-9 bg-white/20 text-white">
          <AvatarFallback class="bg-transparent font-bold">{{ initial }}</AvatarFallback>
        </Avatar>
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
