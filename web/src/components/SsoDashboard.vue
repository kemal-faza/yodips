<script setup lang="ts">
import { ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { User, GraduationCap, Mail, Award, CalendarDays, Cloud } from '@lucide/vue';
import type { Component } from 'vue';

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
  icon: Component;
  ready: boolean;
  view?: 'siap' | 'kulon';
}

const services: Service[] = [
  { key: 'siap', name: 'SIAP', desc: 'Informasi akademik dan biodata', icon: User, ready: true, view: 'siap' },
  { key: 'kulon', name: 'Kulon', desc: 'Tugas dan materi pembelajaran', icon: GraduationCap, ready: true, view: 'kulon' },
  { key: 'mandala', name: 'MANDALA', desc: 'Persuratan online', icon: Mail, ready: false },
  { key: 'beasiswa', name: 'Scholarship', desc: 'Informasi beasiswa', icon: Award, ready: false },
  { key: 'event', name: 'Event', desc: 'Kegiatan kampus', icon: CalendarDays, ready: false },
  { key: 'microsoft', name: 'Microsoft 365', desc: 'Email dan aplikasi', icon: Cloud, ready: false },
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
          :role="s.ready ? 'button' : undefined"
          :tabindex="s.ready ? 0 : undefined"
          :aria-disabled="!s.ready"
          class="text-left transition-all duration-200"
          :class="s.ready ? 'card-hover cursor-pointer hover:border-primary/40' : 'opacity-60 cursor-default'"
          @click="openService(s)"
          @keydown.enter="openService(s)"
        >
          <CardContent class="flex items-center gap-3 p-4">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20"
            >
              <component :is="s.icon" class="size-5" aria-hidden="true" />
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