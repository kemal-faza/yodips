<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CircleCheck, CircleX } from '@lucide/vue';
import QrScanner from '../QrScanner.vue';
import { postKehadiranToken } from '../../api/client';

const router = useRouter();

const scanning = ref(true);
const busy = ref(false);
const result = ref<{ success: boolean; message: string } | null>(null);
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function resume(): void {
  result.value = null;
  busy.value = false;
  scanning.value = true;
}

/** Debounce single-fire ala processing-gate ScanScreen.kt: satu POST per decode. */
async function onDecode(text: string): Promise<void> {
  if (busy.value || result.value) return;
  busy.value = true;
  scanning.value = false;
  let success = false;
  let message: string;
  try {
    const res = await postKehadiranToken(text.trim());
    success = (res.status ?? '').toLowerCase() === 'success';
    message = res.message || (success ? 'Kehadiran tercatat.' : 'Gagal memproses QR.');
  } catch (e: unknown) {
    const anyE = e as { response?: { data?: { message?: string } } };
    message = anyE.response?.data?.message ?? 'Gagal menghubungi server.';
  }
  result.value = { success, message };
  resumeTimer = setTimeout(resume, 2000);
}

onBeforeUnmount(() => clearTimeout(resumeTimer));
</script>

<template>
  <div class="relative min-h-[70vh]" data-test="scan-mobile">
    <QrScanner v-if="scanning" @decode="onDecode" @close="router.back()" />

    <div
      v-else-if="result"
      class="mx-auto mt-10 max-w-sm rounded-xl border p-5 text-center"
      :class="result.success ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10'"
      data-test="scan-result"
      role="status"
    >
      <component
        :is="result.success ? CircleCheck : CircleX"
        class="mx-auto size-10"
        :class="result.success ? 'text-success' : 'text-danger'"
        aria-hidden="true"
      />
      <p class="mt-2 text-base font-bold" :class="result.success ? 'text-success' : 'text-danger'">
        {{ result.success ? 'Berhasil' : 'Gagal' }}
      </p>
      <p class="mt-1 text-sm text-foreground">{{ result.message }}</p>
      <p class="mt-3 text-xs text-muted-foreground">Memindai ulang otomatis…</p>
    </div>
  </div>
</template>
