import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { recoverUpstreamSession } from '../lib/upstream-renewal';

export function useKulonSession() {
  const auth = useAuthStore();
  const sessionExpired = ref(false);
  const error = ref<string | null>(null);
  const recovering = ref(false);

  function extract(e: unknown): string {
    const anyE = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = anyE.response?.status;
    const serverMsg = anyE.response?.data?.message;
    if (status === 401) {
      sessionExpired.value = true;
      return 'Sesi Kulon belum dapat digunakan. Coba pulihkan sesi.';
    }
    return serverMsg || 'Terjadi kesalahan tidak diketahui.';
  }

  async function relogin(): Promise<void> {
    if (recovering.value) return;
    recovering.value = true;
    try {
      const outcome = await recoverUpstreamSession('kulon');
      if (outcome === 'recovered' || outcome === 'conflict') {
        clear();
        await auth.fetchMe();
        auth.sessionVersion += 1;
      } else if (outcome === 'interaction-required') {
        error.value = 'Sesi Kulon memerlukan login SSO. Lanjutkan login di atas.';
      } else if (outcome !== 'cancelled') {
        error.value = 'Pemulihan Kulon belum berhasil. Periksa koneksi dan coba lagi.';
      }
    } finally {
      recovering.value = false;
    }
  }

  function clear(): void {
    sessionExpired.value = false;
    error.value = null;
  }

  return { sessionExpired, error, recovering, extract, relogin, clear };
}
