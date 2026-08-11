<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import KulonNav from '../components/KulonNav.vue';

const route = useRoute();
const router = useRouter();

// Tampilkan tombol back hanya di halaman detail course.
const showBack = computed(() => route.name === 'kulon-course-detail');

function goBack() {
  router.push('/kulon/matakuliah');
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <AppHeader breadcrumb="Kulon" :show-back="showBack" @back="goBack" />
    <main class="mx-auto max-w-6xl px-4 py-6">
      <KulonNav />
      <div class="mt-6">
        <RouterView />
      </div>
    </main>
  </div>
</template>
