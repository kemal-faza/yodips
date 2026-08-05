<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ (e: 'navigate', view: 'siap' | 'tugas'): void }>();

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
  view?: 'siap' | 'tugas';
}

const services: Service[] = [
  { key: 'siap', name: 'SIAP', desc: 'Informasi akademik dan biodata', monogram: 'S', ready: true, view: 'siap' },
  { key: 'kulon', name: 'Online Courses', desc: 'Tugas dan materi pembelajaran', monogram: 'O', ready: true, view: 'tugas' },
  { key: 'mandala', name: 'MANDALA', desc: 'Jadwal perkuliahan', monogram: 'M', ready: false },
  { key: 'beasiswa', name: 'Scholarship', desc: 'Informasi beasiswa', monogram: 'B', ready: false },
  { key: 'event', name: 'Event', desc: 'Kegiatan kampus', monogram: 'E', ready: false },
  { key: 'microsoft', name: 'Microsoft 365', desc: 'Email dan aplikasi', monogram: 'M', ready: false },
];

const news = [
  { title: 'Pengumuman Jadwal UTS', date: '12 Agu 2026' },
  { title: 'Pendaftaran Beasiswa', date: '18 Agu 2026' },
  { title: 'Workshop Karya Ilmiah', date: '25 Agu 2026' },
  { title: 'Seminar Nasional', date: '2 Sep 2026' },
];

function openService(s: Service) {
  if (s.ready && s.view) emit('navigate', s.view);
}
</script>

<template>
  <div class="stagger-children space-y-6">
    <div
      v-if="!dismissed"
      class="flex items-start justify-between gap-4 rounded-2xl bg-gradient-to-r from-sso-green to-sso-green-dark p-6 text-white shadow"
    >
      <div>
        <h1 class="text-xl font-bold">Selamat datang di Undip SSO</h1>
        <p class="mt-1 text-sm text-white/90">
          Akses semua layanan akademik Undip dari satu tempat.
        </p>
      </div>
      <button
        class="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-medium transition hover:bg-white/30"
        @click="dismissWelcome"
      >
        Tutup
      </button>
    </div>

    <section>
      <h2 class="mb-3 text-lg font-bold text-navy">Layanan</h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <button
          v-for="s in services"
          :key="s.key"
          :data-test="`service-${s.key}`"
          class="card-hover rounded-2xl border border-navy/10 bg-white p-5 text-left"
          @click="openService(s)"
        >
          <div class="flex items-start justify-between">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-lg font-bold text-primary-600"
            >
              {{ s.monogram }}
            </div>
            <span
              v-if="!s.ready"
              class="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-navy"
            >
              Coming Soon
            </span>
          </div>
          <p class="mt-3 font-semibold text-navy">{{ s.name }}</p>
          <p class="mt-0.5 text-xs text-navy-light">{{ s.desc }}</p>
        </button>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-lg font-bold text-navy">Berita</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div v-for="n in news" :key="n.title" class="rounded-2xl border border-navy/10 bg-white p-4">
          <p class="text-xs font-medium text-primary-600">{{ n.date }}</p>
          <p class="mt-1 font-semibold text-navy">{{ n.title }}</p>
        </div>
      </div>
    </section>
  </div>
</template>