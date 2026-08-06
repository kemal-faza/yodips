<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { Button } from '@/components/ui/button';
import {
  Home,
  BookOpen,
  ClipboardList,
  GraduationCap,
  LogOut,
  X,
} from '@lucide/vue';

defineProps<{
  mobileOpen?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close-mobile'): void;
}>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const navItems = [
  { label: 'Beranda', icon: Home, path: '/' },
  { label: 'Tugas', icon: ClipboardList, path: '/kulon/dashboard' },
  { label: 'Mata Kuliah', icon: BookOpen, path: '/kulon/matakuliah' },
  { label: 'Akademik', icon: GraduationCap, path: '/siap' },
];

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  if (path === '/kulon/dashboard') return route.path === '/kulon/dashboard';
  if (path === '/kulon/matakuliah') return route.path.startsWith('/kulon/matakuliah');
  return route.path.startsWith(path);
}

function navigate(path: string) {
  router.push(path);
  emit('close-mobile');
}

function logout() {
  auth.logout();
  router.push('/login');
  emit('close-mobile');
}
</script>

<template>
  <div>
    <!-- Mobile Backdrop -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-navy/60 backdrop-blur-xs md:hidden"
      data-test="sidebar-backdrop"
      @click="emit('close-mobile')"
    />

    <!-- Sidebar Container -->
    <aside
      class="fixed bottom-0 top-0 z-50 flex w-64 flex-col border-r border-line bg-card transition-transform duration-200 ease-in-out md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0"
      :class="mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'"
      data-test="app-sidebar"
    >
      <!-- Header / Logo -->
      <div class="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
        <router-link
          to="/"
          class="flex items-center gap-2.5 font-bold text-ink no-underline transition-opacity hover:opacity-85"
          @click="emit('close-mobile')"
        >
          <img
            src="/undip-logo.png"
            alt="Logo Undip"
            class="h-9 w-auto shrink-0"
            aria-hidden="true"
          />
          <div class="flex flex-col">
            <span class="text-sm font-extrabold leading-tight tracking-tight">Undip SSO</span>
            <span class="text-[10px] font-medium text-ink-muted">Academic Portal</span>
          </div>
        </router-link>

        <Button
          variant="ghost"
          size="icon"
          class="size-8 text-ink-muted md:hidden"
          aria-label="Tutup Menu"
          @click="emit('close-mobile')"
        >
          <X class="size-4" aria-hidden="true" />
        </Button>
      </div>

      <!-- Navigation Items -->
      <nav class="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Navigasi Utama">
        <button
          v-for="item in navItems"
          :key="item.path"
          type="button"
          data-test="nav-item"
          :data-path="item.path"
          class="group flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors cursor-pointer"
          :class="
            isActive(item.path)
              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
              : 'text-ink-muted hover:bg-muted hover:text-ink'
          "
          @click="navigate(item.path)"
        >
          <component
            :is="item.icon"
            class="size-4 shrink-0 transition-transform duration-150 group-hover:scale-110"
            :class="isActive(item.path) ? 'text-primary-foreground' : 'text-ink-muted group-hover:text-ink'"
            aria-hidden="true"
          />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </nav>

      <!-- Bottom Sticky Section: User & Logout -->
      <div class="sticky bottom-0 shrink-0 border-t border-line bg-card p-3 space-y-2">
        <Button
          v-if="auth.isAuthenticated"
          variant="ghost"
          size="sm"
          data-test="sidebar-logout"
          class="w-full justify-start gap-2.5 text-danger hover:bg-danger/10 hover:text-danger cursor-pointer"
          @click="logout"
        >
          <LogOut class="size-4 shrink-0" aria-hidden="true" />
          <span class="font-medium text-sm">Keluar</span>
        </Button>
      </div>
    </aside>
  </div>
</template>
