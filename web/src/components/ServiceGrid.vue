<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { User, GraduationCap, Mail, Award, CalendarDays, Cloud } from '@lucide/vue';
import type { Component } from 'vue';

const emit = defineEmits<{ (e: 'navigate', view: 'siap' | 'kulon'): void }>();

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
  <section>
    <h2 class="mb-3 text-lg font-bold text-foreground">Layanan</h2>
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Card
        v-for="s in services"
        :key="s.key"
        :data-test="`service-${s.key}`"
        :role="s.ready ? 'button' : undefined"
        :tabindex="s.ready ? 0 : undefined"
        :aria-disabled="!s.ready"
        class="text-left transition-all duration-200"
        :class="s.ready ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40' : 'opacity-60 cursor-default'"
        @click="openService(s)"
        @keydown.enter="openService(s)"
      >
        <CardContent class="flex items-center gap-3 p-4">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
            <component :is="s.icon" class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-foreground">{{ s.name }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ s.desc }}</p>
          </div>
          <Badge v-if="!s.ready" class="bg-gold/20 text-foreground">Coming Soon</Badge>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
