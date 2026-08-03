<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

const store = useAuthStore();
</script>

<template>
  <header class="bg-navy text-white">
    <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
      <h1 class="text-lg font-bold">Undip SSO Aggregator</h1>
      <button
        v-if="store.isAuthenticated"
        class="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium hover:bg-white/20"
        @click="store.logout()"
      >
        Keluar
      </button>
    </div>
  </header>
</template>