<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import QRCode from 'qrcode';
import { pairRequest } from '../api/client';
import type { PairRequestResult } from '../types';
import { Button } from '@/components/ui/button';

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<PairRequestResult | null>(null);
const remainingSec = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const groupedCode = computed(() => (data.value?.code ?? '').replace(/^(.{4})/, '$1 '));
const countdown = computed(() => {
  const s = remainingSec.value;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer(expiresAt: number) {
  stopTimer();
  const tick = () => {
    remainingSec.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (remainingSec.value <= 0) stopTimer();
  };
  tick();
  timer = setInterval(tick, 1000);
}

async function renderQr(url: string) {
  const el = document.getElementById('pair-qr');
  if (el instanceof HTMLCanvasElement) {
    await QRCode.toCanvas(el, url, { width: 180, margin: 1 });
  }
}

async function requestCode() {
  loading.value = true;
  error.value = null;
  data.value = null;
  try {
    const res = await pairRequest();
    data.value = res;
    startTimer(res.expiresAt);
    await renderQr(res.qrUrl);
  } catch (e: any) {
    error.value =
      e?.response?.status === 401
        ? 'Sesi berakhir. Silakan login ulang.'
        : 'Gagal membuat kode pairing. Coba lagi.';
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(stopTimer);
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-6 space-y-4" data-test="pairing-card">
    <div>
      <h2 class="text-base font-bold text-foreground">Hubungkan Perangkat Lain</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Buka YoDips di iPhone atau iPad, pindai kode ini, atau ketik kodenya di form login.
      </p>
    </div>

    <Button size="sm" :disabled="loading" data-test="pairing-request" @click="requestCode">
      {{ loading ? 'Memproses…' : data ? 'Perbarui kode' : 'Buat kode pairing' }}
    </Button>

    <p v-if="error" class="text-sm text-danger" data-test="pairing-error">{{ error }}</p>

    <div v-if="data" class="flex items-center gap-5" data-test="pairing-result">
      <canvas id="pair-qr" class="rounded-lg border border-border bg-white p-1"></canvas>
      <div>
        <p class="font-mono text-2xl font-bold tracking-widest text-foreground" data-test="pairing-code">
          {{ groupedCode }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          Berlaku <span data-test="pairing-countdown">{{ countdown }}</span>
        </p>
      </div>
    </div>
  </section>
</template>
