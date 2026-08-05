<script setup lang="ts">
import { getCurrentInstance, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { Button } from '@/components/ui/button';

const store = useAuthStore();
// Read $route/$router from the instance proxy: vue-router exposes them as
// global instance properties in the app, and tests inject them via global.mocks.
// The proxy is only fully wired after setup, so resolve it lazily when needed.
const inst = getCurrentInstance()!;
const proxy = () => inst.proxy as any;

onMounted(() => {
  if (store.isHandoffMode) {
    const token = proxy().$route?.query?.token as string | undefined;
    if (token) {
      store.finishHandoff(token);
      proxy().$router?.push('/');
    }
  }
});

async function handleLogin() {
  await store.login();
  if (store.isAuthenticated) {
    await proxy().$router?.push('/');
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-siap-from via-siap-to to-primary-700 px-4">
    <div class="glass-card animate-fade-in-up w-full max-w-md rounded-2xl border border-white/20 p-8 shadow-2xl">
      <h1 class="text-2xl font-bold text-ink">Undip SSO Aggregator</h1>
      <p class="mt-2 text-sm text-ink-muted">
        Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.
      </p>

      <template v-if="store.isHandoffMode">
        <div class="mt-6 rounded bg-navy/5 p-4 text-sm text-ink-muted">
          <p class="font-semibold text-ink">Login via browser kamu</p>
          <ol class="mt-2 list-decimal space-y-1 pl-5">
            <li>Buka Chrome dengan flag remote-debugging (lihat README capture-client).</li>
            <li>Login ke Kulon di window itu.</li>
            <li>jalankan tool capture: <code>node capture-handoff.mjs --api &lt;serverUrl&gt;</code></li>
          </ol>
          <p class="mt-2">Menunggu session dari tool capture…</p>
        </div>
      </template>

      <template v-else>
        <p
          v-if="proxy().$route?.query?.reason === 'incomplete'"
          class="mt-4 rounded bg-warn/10 p-3 text-sm text-ink"
        >
          Session login belum lengkap — pastikan login SSO, Kulon, dan SIAP selesai. Tekan tombol di bawah untuk login ulang.
        </p>
        <Button
          class="mt-6 w-full rounded-full bg-navy py-3 font-semibold text-white transition hover:bg-navy-light disabled:opacity-50"
          :disabled="store.checking"
          @click="handleLogin"
        >
          {{ store.checking ? 'Memeriksa session…' : 'Login via SSO' }}
        </Button>
        <p v-if="store.checking" class="mt-4 text-center text-sm text-ink-muted">
          Tunggu — selesaikan login di window browser yang terbuka. Jika perlu, tunggu hingga halaman dashboard Kulon tampil.
        </p>
      </template>
      <p v-if="store.error" class="mt-4 rounded bg-danger/10 p-3 text-sm text-danger">
        {{ store.error }}
      </p>
    </div>
  </div>
</template>