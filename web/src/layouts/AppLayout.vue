<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import AppSidebar from '../components/AppSidebar.vue';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Bell, Menu, Moon, Sun } from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();

const mobileSidebarOpen = ref(false);

const initial = computed(() => auth.user?.sub?.[0]?.toUpperCase() ?? 'U');

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  'kulon-dashboard': 'Tugas Kulon',
  'kulon-courses': 'Mata Kuliah Kulon',
  'kulon-course-detail': 'Detail Mata Kuliah',
  profile: 'Profil',
};

const pageTitle = computed(() => {
  const name = route.name as string;
  return PAGE_TITLES[name] ?? 'SSO';
});
</script>

<template>
  <div class="flex min-h-screen w-full bg-background text-foreground">
    <!-- Sidebar -->
    <AppSidebar
      :mobile-open="mobileSidebarOpen"
      @close-mobile="mobileSidebarOpen = false"
    />

    <!-- Main Container -->
    <div class="flex flex-1 flex-col min-w-0">
      <!-- Slim Sticky Header -->
      <header
        class="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md md:px-6 shadow-xs"
        data-test="app-header"
      >
        <div class="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            class="size-9 text-muted-foreground hover:text-foreground md:hidden"
            aria-label="Buka Menu"
            data-test="mobile-menu-toggle"
            @click="mobileSidebarOpen = true"
          >
            <Menu class="size-5" aria-hidden="true" />
          </Button>

          <h1 class="text-base md:text-lg font-bold text-foreground truncate leading-tight">
            {{ pageTitle }}
          </h1>
        </div>

        <!-- Header Actions: Theme Toggle, Notification Bell, User Avatar -->
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            class="size-9 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            :aria-label="theme.dark ? 'Pindah ke tema terang' : 'Pindah ke tema gelap'"
            data-test="theme-toggle"
            @click="theme.toggle()"
          >
            <Sun v-if="theme.dark" class="size-4 text-gold" aria-hidden="true" />
            <Moon v-else class="size-4" aria-hidden="true" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            class="size-9 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Notifikasi"
            data-test="notification-toggle"
          >
            <Bell class="size-4" aria-hidden="true" />
          </Button>

          <button
            type="button"
            class="rounded-full transition-opacity hover:opacity-90 cursor-pointer"
            aria-label="Buka halaman profil"
            data-test="avatar-profile"
            @click="router.push('/profile')"
          >
            <Avatar
              size="sm"
              class="size-8 bg-primary/10 text-muted-foreground border border-border"
              data-test="user-avatar"
            >
              <AvatarImage v-if="auth.fotoUrl" :src="auth.fotoUrl" alt="Foto profil" />
              <AvatarFallback class="bg-transparent font-bold text-xs">
                {{ initial }}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </header>

      <!-- Main Content Area -->
      <main class="flex-1 p-4 md:p-6 w-full">
        <router-view />
      </main>
    </div>
  </div>
</template>
