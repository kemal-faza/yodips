<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  CalendarDays,
  ChevronLeft,
  LayoutDashboard,
  ListChecks,
  QrCode,
  UserRound,
} from '@lucide/vue';
import { useAuthStore } from '../stores/auth';
import NotificationPopover from '../components/ui/notification/NotificationPopover.vue';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  'kulon-dashboard': 'Tugas',
  scan: 'Scan QR',
  jadwal: 'Jadwal',
  profile: 'Profil',
  khs: 'KHS',
  irs: 'IRS',
  presensi: 'Presensi',
};

const title = computed(() => PAGE_TITLES[route.name as string] ?? 'YoDips');

// Sub-layar (bukan tab): header dapat tombol kembali (ala FeatureScreen(onBack)).
const SUB_ROUTES = new Set(['khs', 'irs', 'presensi']);
const isSub = computed(() => SUB_ROUTES.has(route.name as string));

const TABS = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard, path: '/', exact: true },
  { id: 'tasks', label: 'Tugas', icon: ListChecks, path: '/kulon/dashboard', exact: false },
  { id: 'scan', label: 'Scan', icon: QrCode, path: '/scan', exact: true, fab: true },
  { id: 'schedule', label: 'Jadwal', icon: CalendarDays, path: '/jadwal', exact: true },
  { id: 'profile', label: 'Profil', icon: UserRound, path: '/profile', exact: true },
] as const;

function isActive(path: string, exact: boolean): boolean {
  return exact ? route.path === path : route.path.startsWith(path);
}

const initial = computed(() => auth.user?.sub?.[0]?.toUpperCase() ?? 'U');
</script>

<template>
  <!-- Shell ala AppShell.kt: header ringkas · konten scroll · bottom-nav 5 slot -->
  <div class="flex h-[100dvh] flex-col bg-background text-foreground">
    <header class="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-card px-3">
      <button
        v-if="isSub"
        type="button"
        data-test="shell-back"
        aria-label="Kembali"
        class="-ml-1 cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-foreground"
        @click="router.back()"
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </button>
      <h1 class="truncate text-base font-bold leading-tight" data-test="shell-title">{{ title }}</h1>

      <div class="ml-auto flex items-center gap-1">
        <NotificationPopover />
        <button
          type="button"
          aria-label="Buka halaman profil"
          data-test="shell-avatar"
          class="cursor-pointer rounded-full transition-opacity hover:opacity-90"
          @click="router.push('/profile')"
        >
          <Avatar size="sm" class="size-8 border border-border bg-primary/10 text-muted-foreground">
            <AvatarImage v-if="auth.fotoUrl" :src="auth.fotoUrl" alt="Foto profil" />
            <AvatarFallback class="bg-transparent text-xs font-bold">{{ initial }}</AvatarFallback>
          </Avatar>
        </button>
      </div>
    </header>

    <main class="min-h-0 w-full flex-1 overflow-y-auto px-4 pb-28 pt-4">
      <router-view />
    </main>

    <!-- Bottom-nav: 4 item + FAB teal tengah; safe-area iOS -->
    <nav
      class="fixed inset-x-0 bottom-0 z-40 flex items-end justify-around border-t border-border bg-card px-2 pt-1 pb-[env(safe-area-inset-bottom)]"
      aria-label="Navigasi utama"
    >
      <template v-for="t in TABS" :key="t.id">
        <!-- Slot tengah: FAB timbul di atas bar (ala ShellBottomBar.kt) -->
        <div v-if="'fab' in t && t.fab" class="flex flex-1 justify-center pb-2">
          <button
            type="button"
            data-test="fab-scan"
            aria-label="Scan QR absensi"
            class="-mt-6 flex size-16 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-card transition-transform active:scale-95"
            @click="router.push(t.path)"
          >
            <QrCode class="size-7" aria-hidden="true" />
          </button>
        </div>
        <button
          v-else
          type="button"
          :data-test="'tab-' + t.id"
          class="flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors"
          :class="isActive(t.path, t.exact) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          :aria-current="isActive(t.path, t.exact) ? 'page' : undefined"
          @click="router.push(t.path)"
        >
          <component :is="t.icon" class="size-5" aria-hidden="true" />
          {{ t.label }}
        </button>
      </template>
    </nav>
  </div>
</template>
