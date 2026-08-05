<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bell, Home, Moon, Sun } from '@lucide/vue';

defineProps<{ showBack?: boolean; breadcrumb?: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const store = useAuthStore();
const theme = useThemeStore();
// Avatar initial from the logged-in identity (NIM in store.user.sub), else 'U'.
const initial = store.user?.sub?.[0]?.toUpperCase() ?? 'U';
</script>

<template>
  <header class="bg-navy text-white shadow-sm">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
      <div class="flex items-center gap-3">
        <Button
          v-if="showBack"
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/20 hover:text-white"
          aria-label="Kembali"
          @click="emit('back')"
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
        </Button>
        <router-link to="/" class="flex items-center gap-2 text-white no-underline hover:opacity-90">
          <Home class="size-4 shrink-0" aria-hidden="true" />
          <div>
            <h1 class="text-lg font-bold leading-tight">Undip SSO Aggregator</h1>
            <p v-if="breadcrumb" class="text-xs text-white/70">{{ breadcrumb }}</p>
          </div>
        </router-link>
      </div>
      <div class="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/20 hover:text-white"
          :aria-label="theme.dark ? 'Pindah ke tema terang' : 'Pindah ke tema gelap'"
          data-test="theme-toggle"
          @click="theme.toggle()"
        >
          <Sun v-if="theme.dark" class="size-4" aria-hidden="true" />
          <Moon v-else class="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/20 hover:text-white"
          aria-label="Notifikasi"
        >
          <Bell class="size-4" aria-hidden="true" />
        </Button>
        <Avatar size="default" class="bg-white/20 text-white">
          <AvatarFallback class="bg-transparent font-bold">{{ initial }}</AvatarFallback>
        </Avatar>
        <Button
          v-if="store.isAuthenticated"
          variant="ghost"
          size="sm"
          class="text-white hover:bg-white/20 hover:text-white"
          @click="store.logout()"
        >
          Keluar
        </Button>
      </div>
    </div>
  </header>
</template>
