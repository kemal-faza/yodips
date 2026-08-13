import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

export function useKulonSession() {
  const auth = useAuthStore();
  const router = useRouter();
  const sessionExpired = ref(false);
  const error = ref<string | null>(null);

  function extract(e: unknown): string {
    const anyE = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status = anyE.response?.status;
    const serverMsg = anyE.response?.data?.message;
    if (status === 401 || status === 403) {
      sessionExpired.value = true;
      return serverMsg || 'Session Kulon kedaluwarsa — silakan login ulang.';
    }
    return serverMsg || 'Terjadi kesalahan tidak diketahui.';
  }

  async function relogin(): Promise<void> {
    // Drop JWT agar guard router tidak memantulkan /login kembali ke /dashboard.
    auth.clearSessionState();
    clear(); // reset sessionExpired/error lokal
    await router.push({ name: 'login' });
  }

  function clear(): void {
    sessionExpired.value = false;
    error.value = null;
  }

  return { sessionExpired, error, extract, relogin, clear };
}