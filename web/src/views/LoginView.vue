<script setup lang="ts">
import { getCurrentInstance, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

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
    <Card class="glass-card animate-fade-in-up w-full max-w-md border-white/20 shadow-2xl">
      <CardHeader class="px-6 pt-6">
        <h1 class="text-2xl font-bold">Undip SSO Aggregator</h1>
        <p class="mt-2 text-sm text-ink-muted">
          Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.
        </p>
      </CardHeader>
      <CardContent class="px-6 pb-6">

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
        <Alert
          v-if="proxy().$route?.query?.reason === 'incomplete'"
          class="mt-4 border-warn/40 bg-warn/10 p-3"
        >
          <AlertDescription class="text-ink">
            Session login belum lengkap — pastikan login SSO, Kulon, dan SIAP selesai. Tekan tombol di bawah untuk login ulang.
          </AlertDescription>
        </Alert>
        <Button
          size="lg"
          class="mt-6 h-11 w-full"
          :disabled="store.checking"
          @click="handleLogin"
        >
          {{ store.checking ? 'Memeriksa session…' : 'Login via SSO' }}
        </Button>
        <p v-if="store.checking" class="mt-4 text-center text-sm text-ink-muted">
          Tunggu — selesaikan login di window browser yang terbuka. Jika perlu, tunggu hingga halaman dashboard Kulon tampil.
        </p>
      </template>
      <Alert v-if="store.error" variant="destructive" class="mt-4 bg-danger/10 p-3">
        <AlertDescription>{{ store.error }}</AlertDescription>
      </Alert>
      </CardContent>
    </Card>
  </div>
</template>