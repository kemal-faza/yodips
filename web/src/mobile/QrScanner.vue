<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import jsQR from 'jsqr';
import { Button } from '@/components/ui/button';
import { X } from '@lucide/vue';

const emit = defineEmits<{ (e: 'close'): void; (e: 'decode', text: string): void }>();

const videoRef = ref<HTMLVideoElement | null>(null);
const error = ref<string | null>(null);

let stream: MediaStream | null = null;
let rafId = 0;
let stopped = false;

function stop() {
  stopped = true;
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function handleClose() {
  stop();
  emit('close');
}

async function start() {
  error.value = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    const video = videoRef.value;
    if (!video) return;
    video.srcObject = stream;
    await video.play();
    tick();
  } catch (e: any) {
    error.value =
      e?.name === 'NotAllowedError'
        ? 'Kamera tidak diizinkan. Izinkan akses kamera di pengaturan Safari/PWA, lalu coba lagi.'
        : 'Kamera tidak tersedia. Coba lagi.';
  }
}

function tick() {
  if (stopped) return;
  const video = videoRef.value;
  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx && canvas.width > 0 && canvas.height > 0) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) {
        emit('decode', found.data);
        return; // satu decode per overlay; pemanggil yang menutup
      }
    }
  }
  rafId = requestAnimationFrame(tick);
}

onMounted(start);
onBeforeUnmount(stop);
defineExpose({ stop });
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      data-test="qr-scanner"
    >
      <video ref="videoRef" class="absolute inset-0 h-full w-full object-cover" playsinline muted></video>
      <div class="relative z-10 h-64 w-64 rounded-xl border-2 border-white/70"></div>
      <Button
        variant="ghost"
        class="absolute right-4 top-4 z-20 text-white hover:bg-white/10"
        aria-label="Tutup scanner"
        @click="handleClose"
      >
        <X class="size-6" aria-hidden="true" />
      </Button>
      <p v-if="error" class="relative z-10 mt-6 max-w-xs rounded bg-danger/20 p-3 text-center text-sm text-white">
        {{ error }}
      </p>
      <p v-else class="relative z-10 mt-6 text-sm text-white/80">Arahkan QR ke dalam kotak</p>
    </div>
  </Teleport>
</template>
