<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import SsoDashboard from '../components/SsoDashboard.vue';

const router = useRouter();
function navigate(view: 'siap' | 'kulon') {
  router.push(view === 'siap' ? '/siap' : '/kulon');
}
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <AppHeader />
    <main class="mx-auto max-w-6xl px-4 py-8">
      <SsoDashboard @navigate="navigate" />
    </main>
  </div>
</template>