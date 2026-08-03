<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';

const store = useAuthStore();
const router = useRouter();

async function handleLogin() {
  await store.login();
  if (store.isAuthenticated) {
    await router.push('/');
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-canvas px-4">
    <div class="w-full max-w-md rounded-card bg-white p-8 shadow-sm">
      <h1 class="text-2xl font-bold text-navy">Undip SSO Aggregator</h1>
      <p class="mt-2 text-sm text-navy-light">
        Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.
      </p>
      <button
        class="mt-6 w-full rounded-full bg-navy py-3 font-semibold text-white transition hover:bg-navy-light disabled:opacity-50"
        :disabled="store.capturing"
        @click="handleLogin"
      >
        {{ store.capturing ? 'Menunggu login di browser…' : 'Login via SSO' }}
      </button>
      <p v-if="store.capturing" class="mt-4 text-center text-sm text-navy-light">
        Sebuah jendela browser baru akan terbuka. Silakan login dengan akun SSO kamu di sana.
      </p>
      <p v-if="store.error" class="mt-4 rounded bg-danger/10 p-3 text-sm text-danger">
        {{ store.error }}
      </p>
    </div>
  </div>
</template>