import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

export function useKulonSession() {
  const auth = useAuthStore();
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

  async function relogin(after: () => Promise<void>): Promise<void> {
    // Prefer the extension flow when it is actually installed: it re-establishes
    // the SSO/Kulon/SIAP cookies without the legacy Playwright/CDP capture
    // (which needs a separately launched Chrome). Legacy capture is the fallback.
    if (await auth.isExtensionInstalled()) {
      const status = await auth.loginViaExtension();
      if (status === 'ok' && auth.isAuthenticated) await after();
      return;
    }
    await auth.login();
    if (auth.isAuthenticated) await after();
  }

  function clear(): void {
    sessionExpired.value = false;
    error.value = null;
  }

  return { sessionExpired, error, extract, relogin, clear };
}