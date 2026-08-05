<script setup lang="ts">
import { ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const emit = defineEmits<{ (e: 'navigate', view: 'siap' | 'kulon'): void }>();

const DISMISS_KEY = 'sso_welcome_dismissed';
const dismissed = ref(localStorage.getItem(DISMISS_KEY) === '1');

function dismissWelcome() {
  dismissed.value = true;
  localStorage.setItem(DISMISS_KEY, '1');
}

interface Service {
  key: string;
  name: string;
  desc: string;
  monogram: string;
  ready: boolean;
  view?: 'siap' | 'kulon';
}

const services: Service[] = [
  { key: 'siap', name: 'SIAP', desc: 'Informasi akademik dan biodata', monogram: 'S', ready: true, view: 'siap' },
  { key: 'kulon', name: 'Kulon', desc: 'Tugas dan materi pembelajaran', monogram: 'K', ready: true, view: 'kulon' },
  { key: 'mandala', name: 'MANDALA', desc: 'Jadwal perkuliahan', monogram: 'M', ready: false },
  { key: 'beasiswa', name: 'Scholarship', desc: 'Informasi beasiswa', monogram: 'B', ready: false },
  { key: 'event', name: 'Event', desc: 'Kegiatan kampus', monogram: 'E', ready: false },
  { key: 'microsoft', name: 'Microsoft 365', desc: 'Email dan aplikasi', monogram: 'M', ready: false },
];

function openService(s: Service) {
  if (s.ready && s.view) emit('navigate', s.view);
}
</script>

<template>
  <div class="stagger-children space-y-6">
    <div
      v-if="!dismissed"
      class="flex items-start justify-between gap-4 rounded-xl bg-sso-green p-5 text-white shadow-sm"
    >
      <div>
        <h1 class="text-lg font-bold">Selamat datang di Undip SSO</h1>
        <p class="mt-0.5 text-sm text-white/80">
          Akses semua layanan akademik Undip dari satu tempat.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 text-white hover:bg-white/30"
        @click="dismissWelcome"
      >
        Tutup
      </Button>
    </div>

    <section>
      <h2 class="mb-3 text-lg font-bold text-ink">Layanan</h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card
          v-for="s in services"
          :key="s.key"
          :data-test="`service-${s.key}`"
          role="button"
          tabindex="0"
          class="card-hover cursor-pointer text-left"
          @click="openService(s)"
          @keydown.enter="openService(s)"
        >
          <CardContent class="flex items-center gap-3 p-4">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600 dark:bg-primary-500/15 dark:text-primary-400"
            >
              {{ s.monogram }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium text-ink">{{ s.name }}</p>
              <p class="truncate text-xs text-ink-muted">{{ s.desc }}</p>
            </div>
            <Badge v-if="!s.ready" class="bg-gold/20 text-ink">Coming Soon</Badge>
          </CardContent>
        </Card>
      </div>
    </section>
  </div>
</template>