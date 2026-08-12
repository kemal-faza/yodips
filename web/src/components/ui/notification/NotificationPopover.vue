<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getNotifications, markNotificationRead } from '../../../api/client';
import type { SiapNotification } from '../../../types';
import { Bell, AlertTriangle, Clock, CircleCheck, Info, CheckCheck, X } from '@lucide/vue';

const open = ref(false);
const isMounted = ref(false);
const filter = ref<'all' | 'unread'>('all');
const items = ref<SiapNotification[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const rootEl = ref<HTMLElement | null>(null);

const unreadCount = computed(() => items.value.filter((n) => !n.read).length);
const filtered = computed(() =>
  filter.value === 'unread' ? items.value.filter((n) => !n.read) : items.value,
);

const typeIcon: Record<SiapNotification['type'], any> = {
  warning: AlertTriangle,
  urgent: Clock,
  success: CircleCheck,
  info: Info,
};

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await getNotifications();
    items.value = res.items;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? 'Gagal memuat notifikasi.';
  } finally {
    loading.value = false;
  }
}

function toggle() {
  if (isMounted.value && open.value) {
    open.value = false;
    setTimeout(() => (isMounted.value = false), 150);
  } else {
    isMounted.value = true;
    open.value = true;
  }
}
function close() {
  open.value = false;
  setTimeout(() => (isMounted.value = false), 150);
}

async function markRead(n: SiapNotification) {
  if (n.read) return;
  try {
    await markNotificationRead(n.id);
    n.read = true;
  } catch {
    /* keep local state; surface on next fetch */
  }
}
async function markAllRead() {
  await Promise.all(items.value.filter((n) => !n.read).map((n) => markRead(n)));
}

function onClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  load();
  document.addEventListener('mousedown', onClickOutside);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Notifikasi"
      data-test="notification-toggle"
      @click="toggle"
    >
      <Bell class="size-4" aria-hidden="true" />
      <span
        v-if="unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white shadow-sm"
      >{{ unreadCount }}</span>
    </button>

    <div
      v-if="isMounted"
      class="absolute right-0 z-50 mt-2 w-80 border border-border bg-card text-foreground shadow-2xl sm:w-96"
    >
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <span class="text-sm font-bold">Notifikasi</span>
        <div class="flex items-center gap-2 text-xs">
          <button
            v-if="unreadCount > 0"
            class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            data-test="mark-all-read"
            @click="markAllRead"
          ><CheckCheck class="size-3.5" /><span>Tandai Dibaca</span></button>
          <button class="text-muted-foreground hover:text-foreground" aria-label="Tutup" @click="close">
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <div class="flex border-b border-border bg-muted/30 text-xs">
        <button
          class="flex-1 py-2 text-center transition-colors"
          :class="filter === 'all' ? 'font-bold text-foreground' : 'text-muted-foreground'"
          @click="filter = 'all'"
        >Semua ({{ items.length }})</button>
        <button
          class="flex-1 py-2 text-center transition-colors"
          :class="filter === 'unread' ? 'font-bold text-foreground' : 'text-muted-foreground'"
          @click="filter = 'unread'"
        >Belum Dibaca ({{ unreadCount }})</button>
      </div>

      <div class="max-h-80 overflow-y-auto divide-y divide-border/60">
        <div v-if="loading" class="p-6 text-center text-xs text-muted-foreground">Memuat…</div>
        <div v-else-if="error" class="p-6 text-center text-xs text-danger">{{ error }}</div>
        <div v-else-if="filtered.length === 0" class="p-6 text-center text-xs text-muted-foreground">
          Tidak ada notifikasi.
        </div>
        <div
          v-else
          v-for="n in filtered"
          :key="n.id"
          class="group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors"
          :class="!n.read ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/40'"
          @click="markRead(n)"
        >
          <component :is="typeIcon[n.type]" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-xs" :class="!n.read ? 'font-bold' : 'font-medium text-foreground/80'">{{ n.title }}</h4>
              <span class="shrink-0 text-[10px] text-muted-foreground/70">{{ n.timestamp }}</span>
            </div>
            <p class="mt-1 text-xs leading-snug text-muted-foreground">{{ n.message }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>