<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
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
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Tugas', icon: ClipboardList, path: '/kulon/dashboard' },
  { label: 'Mata Kuliah', icon: BookOpen, path: '/kulon/matakuliah' },
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

async function logout() {
  await auth.logout();
  router.push('/login');
  emit('close-mobile');
}
</script>

<template>
  <div>
    <!-- Mobile Backdrop -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-primary/60 backdrop-blur-xs md:hidden"
      data-test="sidebar-backdrop"
      @click="emit('close-mobile')"
    />

    <!-- Sidebar Container -->
    <aside
      class="fixed bottom-0 top-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 ease-in-out md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0"
      :class="mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'"
      data-test="app-sidebar"
    >
      <!-- Header / Logo -->
      <div class="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <router-link
          to="/"
          class="flex items-center gap-2.5 font-bold text-foreground no-underline transition-opacity hover:opacity-85"
          @click="emit('close-mobile')"
        >
          <img
            src="/yodips-logo.png"
            alt="Logo Undip"
            class="h-9 w-auto shrink-0"
            aria-hidden="true"
          />
          <div class="flex flex-col">
            <span class="text-sm font-extrabold leading-tight tracking-tight">YoDips</span>
            <span class="text-[10px] font-medium text-muted-foreground">Academic Portal</span>
          </div>
        </router-link>

        <Button
          variant="ghost"
          size="icon"
          class="size-8 text-muted-foreground md:hidden"
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
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="navigate(item.path)"
        >
          <component
            :is="item.icon"
            class="size-4 shrink-0 transition-transform duration-150 group-hover:scale-110"
            :class="isActive(item.path) ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'"
            aria-hidden="true"
          />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </nav>

      <!-- Bottom Sticky Section: User & Logout -->
      <div class="sticky bottom-0 shrink-0 border-t border-border bg-card">
        <button
          v-if="auth.isAuthenticated"
          type="button"
          data-test="sidebar-logout"
          class="group flex w-full items-center gap-3 px-3.5 py-2.5 text-sm font-medium transition-colors cursor-pointer text-danger hover:bg-danger/10 hover:text-danger"
          @click="logout"
        >
          <LogOut class="size-4 shrink-0 transition-transform duration-150 group-hover:scale-110" aria-hidden="true" />
          <span class="truncate">Keluar</span>
        </button>
      </div>
    </aside>
  </div>
</template>
