<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue';
import KulonNav from '../components/KulonNav.vue';
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <AppHeader breadcrumb="Kulon" />
    <main class="mx-auto max-w-6xl px-4 py-6">
      <KulonNav />
      <div class="mt-6">
        <RouterView />
      </div>
    </main>
  </div>
</template>
