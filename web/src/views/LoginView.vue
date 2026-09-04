<script setup lang="ts">
import { getCurrentInstance, onMounted, onUnmounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useExtension, type ExtOutboundStatus } from '../composables/useExtension';
import { Button } from '@/components/ui/button';
import InteractiveHoverButton from '@/components/ui/button/InteractiveHoverButton.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import AuroraBackground from '@/components/ui/aurora-background/AuroraBackground.vue';
import MultiStepLoader from '@/components/ui/multi-step-loader/MultiStepLoader.vue';
import { SSO_CAPTURE_ENABLED, isMobileUserAgent } from '../config/extension';

const store = useAuthStore();
const inst = getCurrentInstance()!;
const proxy = () => inst.proxy as any;
const ext = useExtension();

const extInstalled = ref(false);
const extChecking = ref(true);
const extBusy = ref(false); // initial handoff request in flight
const extWaiting = ref(false); // extension flow active (login tab open / semi confirm)
const extMode = ref<'auto' | 'semi'>('auto');
const extMsg = ref<string | null>(null);
const extPhase = ref<string | null | undefined>(undefined);
const phaseToStep: Record<string, number> = { sso: 0, kulon: 1, siap: 2 };
// Di HP jalur /sso/capture (dan extension) tidak relevan — arahkan ke app.
const isMobile = isMobileUserAgent();
// Jalur interaktif Playwright di-server = single-admin/dev-only.
const ssoCaptureEnabled = SSO_CAPTURE_ENABLED && !isMobile;
let stopListening: (() => void) | null = null;
let stopFocusListeners: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 3000;

/** Stop the self-healing result poll (on success/error/unmount). */
function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Self-healing wait: while the extension flow is active, poll its state
 * ({action:'status'}) until it reports ok/error. This makes the app enter the
 * dashboard on its own even if every content-bridge push message was missed —
 * the user never has to re-click "Login via Extension".
 */
async function pollExtensionResult() {
  const payload = await store.readExtensionResult();
  if (!payload) return; // extension not available — keep waiting
  extPhase.value = payload.phase ?? null;
  if (payload.status === 'ok' && payload.accessToken) {
    stopPoll();
    store.finishHandoff(payload.accessToken);
    proxy().$router?.push('/');
  } else if (payload.status === 'error') {
    stopPoll();
    extWaiting.value = false;
    extBusy.value = false;
    extMsg.value = payload.message ?? 'Login via extension gagal.';
  }
  // {status:'ok', active:true} → still in progress, keep waiting.
}

function startWaiting(mode: 'auto' | 'semi') {
  extWaiting.value = true;
  extMode.value = mode;
  extBusy.value = false;
  stopPoll(); // avoid stacking intervals
  pollTimer = setInterval(pollExtensionResult, POLL_INTERVAL_MS);
}

async function checkExtension() {
  extChecking.value = true;
  try {
    extInstalled.value = await store.isExtensionInstalled();
  } finally {
    extChecking.value = false;
  }
}

/**
 * YD-AUTH-002: the deprecated capture tool delivers the JWT via a URL
 * FRAGMENT (`#access_token=…`), which browsers never send to the server, so
 * request/proxy logs cannot capture it. Parse + validate it here (returns null
 * for absent/malformed); the caller SCRUBS the URL first, then consumes the
 * token exactly once.
 */
const FRAGMENT_TOKEN_MAX_LEN = 4096;
function parseFragmentAccessToken(hash: string | undefined): string | null {
  if (!hash || hash.length === 0) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^access_token=([^&]+)/.exec(raw);
  if (!match) return null;
  const token = match[1];
  if (!token || token.length === 0 || token.length > FRAGMENT_TOKEN_MAX_LEN) return null;
  // Loose JWT-shape guard: exactly three NONEMPTY segments separated by '.',
  // each segment URL-safe base64url (header.payload.signature). Enough to drop
  // garbage before it reaches localStorage; the backend fully verifies on use.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

onMounted(async () => {
  await checkExtension();
  // Listen for the extension's final result (posted to the window by the
  // content-script bridge). Handles both success (JWT) and failure/timeout.
  stopListening = store.onExtensionResult((payload: ExtOutboundStatus) => {
    extWaiting.value = false;
    extBusy.value = false;
    stopPoll();
    if (payload?.status === 'ok' && payload.accessToken) {
      store.finishHandoff(payload.accessToken);
      proxy().$router?.push('/');
    } else if (payload?.status === 'error') {
      extMsg.value = payload.message ?? 'Login via extension gagal.';
    }
  });
  // When the user switches back from the login tab (focus/visibility), do an
  // immediate result check instead of waiting up to the poll interval.
  const onFocus = () => {
    if (extWaiting.value) pollExtensionResult();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  stopFocusListeners = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
  if (store.isHandoffMode) {
    const token = parseFragmentAccessToken(proxy().$route?.hash as string | undefined);
    if (token) {
      // History hygiene FIRST — synchronously, before any store write or await —
      // so no async storage/navigation work can run while the secret is still in
      // the URL. Preserve the existing history state object (never null), which
      // keeps history.back() behavior intact; a null state would corrupt it.
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(window.history.state, '', cleanUrl);
      store.finishHandoff(token);
      // router.replace re-writes the SAME history entry via vue-router's own
      // replaceState — no extra replaceState call is needed or wanted.
      await proxy().$router?.replace('/');
    }
  }
});

onUnmounted(() => {
  stopListening?.();
  stopPoll();
  stopFocusListeners?.();
});

async function handleLogin() {
  await store.login();
  if (store.isAuthenticated) {
    await proxy().$router?.push('/');
  }
}

async function handleExtensionLogin() {
  extBusy.value = true;
  extMsg.value = null;
  const status = await store.loginViaExtension();
  if (status === 'ok') {
    await proxy().$router?.push('/');
    extBusy.value = false;
    return;
  }
  if (status === 'started') {
    // The background opened a login tab (auto) or waits for explicit "Selesai"
    // confirmation (semi). The bridge result/status poll delivers the JWT.
    startWaiting(store.extensionMode ?? 'auto');
    return;
  }
  if (status === 'error') {
    extMsg.value = store.error ?? 'Login via extension gagal. Pastikan server berjalan.';
    extBusy.value = false;
  } else {
    extMsg.value = 'Extension belum terpasang atau tidak merespons.';
    extBusy.value = false;
  }
}

async function handleExtensionDone() {
  await ext.sendDone();
}
</script>

<template>
  <AuroraBackground class="flex min-h-screen items-center justify-center px-4">
    <Card class="animate-fade-in-up w-full max-w-md border-border/20 shadow-2xl">
      <CardHeader class="flex flex-col items-center gap-3 px-6 pt-8 text-center">
        <img
          src="/yodips-logo.png"
          alt="Logo Undip"
          class="h-20 w-auto shrink-0"
          aria-hidden="true"
        />
        <h1 class="text-2xl font-bold">YoDips</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.
        </p>
      </CardHeader>
      <CardContent class="px-6 pb-6">

      <template v-if="store.isHandoffMode">
        <div class="mt-6 rounded bg-primary/5 p-4 text-sm text-muted-foreground">
          <p class="font-semibold text-foreground">Login via browser kamu</p>
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
          <AlertDescription class="text-foreground">
            Session login belum lengkap — pastikan login SSO, Kulon, dan SIAP selesai. Tekan tombol di bawah untuk login ulang.
          </AlertDescription>
        </Alert>
        <Button
          v-if="extChecking"
          size="lg"
          class="mt-6 h-11 w-full"
          disabled
        >
          Memeriksa…
        </Button>
        <InteractiveHoverButton
          v-else-if="!extInstalled && ssoCaptureEnabled"
          class="mt-6 h-11 w-full"
          :disabled="store.checking"
          :text="store.checking ? 'Memeriksa session…' : 'Login via SSO'"
          @click="handleLogin"
        />
        <!-- Desktop tanpa extension & tanpa jalur capture (produksi): beri panduan. -->
        <Alert v-else-if="!extInstalled && !ssoCaptureEnabled" class="mt-6 border-warn/40 bg-warn/10 p-3">
          <AlertDescription class="text-sm text-foreground">
            Login via web membutuhkan extension <strong>YoDips</strong>.
            Pasang di Chrome/Edge lalu kembali ke halaman ini. (Jalur login
            interaktif hanya aktif di lingkungan pengembangan.)
          </AlertDescription>
        </Alert>
        <InteractiveHoverButton
          v-if="extInstalled && !extWaiting"
          class="mt-6 h-11 w-full"
          :disabled="extBusy"
          :text="extBusy ? 'Menghubungkan…' : 'Login via Extension'"
          @click="handleExtensionLogin"
        />
        <div v-if="extWaiting" class="mt-6 flex flex-col gap-3">
          <MultiStepLoader
            :loading="extWaiting"
            :current="phaseToStep[extPhase ?? ''] ?? 0"
            :steps="[
              { text: 'SSO' },
              { text: 'Kulon' },
              { text: 'SIAP' },
            ]"
            prevent-close
          >
            <div v-if="extMode === 'semi'" class="flex flex-col items-center gap-2">
              <p class="text-center text-xs text-muted-foreground">Selesaikan login layanan di tab yang terbuka, lalu klik tombol untuk melanjutkan.</p>
              <Button size="lg" class="w-full" @click="handleExtensionDone">Selesai login</Button>
            </div>
            <p v-else class="text-center text-xs text-muted-foreground">Menunggu… tab akan ditutup otomatis.</p>
          </MultiStepLoader>
        </div>
        <Alert v-if="!extInstalled && store.extensionError" class="mt-4 border-warn/40 bg-warn/10 p-3">
          <AlertDescription class="text-foreground">
            {{ store.extensionError }} Muat ulang extension di <code>chrome://extensions</code>,
            lalu pastikan <code>VITE_EXTENSION_ID</code> di <code>web/.env</code> sama dengan ID extension.
          </AlertDescription>
        </Alert>
        <Alert v-if="extMsg" variant="destructive" class="mt-4 bg-danger/10 p-3">
          <AlertDescription>{{ extMsg }}</AlertDescription>
        </Alert>
        <p v-if="!extInstalled && ssoCaptureEnabled" class="mt-3 text-center text-xs text-muted-foreground">
          Login membuka window Chrome terpisah. Jika langsung masuk tanpa window, sesi kamu masih
          valid — tidak perlu menekan ulang.
        </p>
        <p v-if="store.checking" class="mt-4 text-center text-sm text-muted-foreground">
          Tunggu — selesaikan login di window browser yang terbuka. Jika perlu, tunggu hingga halaman dashboard Kulon tampil.
        </p>
      </template>
      <Alert v-if="store.error" variant="destructive" class="mt-4 bg-danger/10 p-3">
        <AlertDescription>{{ store.error }}</AlertDescription>
      </Alert>
      </CardContent>
    </Card>
    <p class="mt-4 text-center text-xs text-muted-foreground">
      Dengan melanjutkan, kamu menyetujui
      <a href="/privacy" class="font-medium text-primary hover:underline">
        Kebijakan Privasi
      </a>.
    </p>
  </AuroraBackground>
</template>