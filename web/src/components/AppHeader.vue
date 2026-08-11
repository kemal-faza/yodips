<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bell, Moon, Sun } from '@lucide/vue';

defineProps<{ showBack?: boolean; breadcrumb?: string }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const store = useAuthStore();
const theme = useThemeStore();
const router = useRouter();
// Avatar initial from the logged-in identity (NIM in store.user.sub), else 'U'.
const initial = computed(() => store.user?.sub?.[0]?.toUpperCase() ?? 'U');

function goToSiap() {
  router.push('/siap');
}
</script>

<template>
  <header class="bg-primary text-primary-foreground shadow-sm">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
      <div class="flex items-center gap-3">
        <Button
          v-if="showBack"
          variant="ghost"
          size="icon"
          class="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
          aria-label="Kembali"
          @click="emit('back')"
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
        </Button>
        <router-link to="/" class="flex items-center gap-2 text-primary-foreground no-underline hover:opacity-90">
          <img src="/undip-logo.png" alt="Logo Undip" class="h-8 w-auto shrink-0" aria-hidden="true" />
          <div>
            <h1 class="text-lg font-bold leading-tight">SSO</h1>
            <p v-if="breadcrumb" class="text-xs text-primary-foreground/70">{{ breadcrumb }}</p>
          </div>
        </router-link>
      </div>
      <div class="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          class="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
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
          class="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
          aria-label="Notifikasi"
        >
          <Bell class="size-4" aria-hidden="true" />
        </Button>
        <button
          type="button"
          class="rounded-full transition-opacity hover:opacity-90 cursor-pointer"
          aria-label="Buka halaman SIAP"
          data-test="avatar-siap"
          @click="goToSiap"
        >
          <Avatar size="default" class="bg-primary-foreground/20 text-primary-foreground">
            <AvatarImage v-if="store.fotoUrl" :src="store.fotoUrl" alt="Foto" />
            <AvatarFallback class="bg-transparent font-bold">{{ initial }}</AvatarFallback>
          </Avatar>
        </button>
        <Button
          v-if="store.isAuthenticated"
          variant="ghost"
          size="sm"
          class="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
          @click="store.logout()"
        >
          Keluar
        </Button>
      </div>
    </div>
  </header>
</template>
