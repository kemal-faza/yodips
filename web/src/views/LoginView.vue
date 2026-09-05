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
import { parseFragmentAccessToken } from '../lib/handoff-token';
import { getReauthEpoch, isLogoutInProgress } from '../lib/logout';

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
// Epoch ownership + serialization (reviewers C/D): every async handoff flow
// captures the reauth epoch BEFORE its first await and must present it at the
// commit boundary (finishHandoff/loginViaExtension/login + router navigation +
// overlay mutation). A logout that fully resolves (epoch bumped, flag down)
// while a flow is pending orphans it: late results never commit, never
// navigate, never mutate overlay. flows are owned by a monotonic generation —
// an old flow can neither clear a newer timer nor mutate newer overlay state.
// The poll uses a recursive timeout (never overlapping) plus an in-flight gate
// (focus-triggered immediate checks cannot overlap a scheduled tick).
let flowGen = 0;
let flowEpoch: number | null = null;
// Mount-epoch for bridge results that arrive with no click-flow active: the
// setup body runs synchronously (no await can interleave), so this is the
// current-flow epoch by construction. A logout after mount bumps the epoch and
// orphaned bridge results are discarded via the mismatch below.
const mountEpoch = getReauthEpoch();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlightGen: number | null = null;
let disposed = false;
const POLL_INTERVAL_MS = 3000;

/** Stop the self-healing result poll. Gen-guarded: an old flow can never clear
 *  a newer flow's timer. Unconditional (no gen) = takeover/unmount only. */
function stopPoll(gen?: number) {
  if (gen !== undefined && gen !== flowGen) return; // old flow — never clear newer timer
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/** Schedule the next serialized poll tick for the owning flow only. */
function scheduleNextPoll(gen: number, epoch: number) {
  if (disposed) return;
  if (gen !== flowGen) return; // superseded — newer flow owns the timer now
  if (getReauthEpoch() !== epoch) return; // crossed logout — orphaned, never reschedule
  if (!extWaiting.value) return; // terminal (ok/error) — stop chaining
  if (pollTimer) return; // a tick is already scheduled — never stack timeouts
  pollTimer = setTimeout(() => {
    pollTimer = null; // fired — the tick below reschedules on in-progress
    void pollExtensionResult(gen, epoch);
  }, POLL_INTERVAL_MS);
}

/**
 * Self-healing wait: while the extension flow is active, poll its state
 * ({action:'status'}) until it reports ok/error. This makes the app enter the
 * dashboard on its own even if every content-bridge push message was missed —
 * the user never has to re-click "Login via Extension". Serialized (recursive
 * timeout + in-flight gate): overlapping reads and out-of-order application
 * are impossible; every post-await mutation re-checks disposed/ownership/epoch.
 */
async function pollExtensionResult(tickGen?: number, tickEpoch?: number | null) {
  const gen = tickGen ?? flowGen;
  const epoch = tickEpoch ?? flowEpoch;
  if (epoch === null || epoch === undefined) return; // no flow — never read
  if (disposed) return;
  if (gen !== flowGen) return; // old flow — never read
  if (getReauthEpoch() !== epoch) return; // crossed logout before read — never read
  if (pollInFlightGen === gen) return; // serialize this flow's reads
  // A newer flow owns an independent read. The old flow's finally is
  // identity-guarded below and cannot clear the newer flow's gate.
  pollInFlightGen = gen;
  try {
    const payload = await store.readExtensionResult();
    // After EVERY await: settled/disposed, ownership, epoch — before ANY
    // phase/token/overlay mutation.
    if (disposed) return;
    if (gen !== flowGen) return; // superseded while awaiting — never mutate
    if (getReauthEpoch() !== epoch) return; // logout crossed while awaiting — discard
    if (isLogoutInProgress()) return;
    if (!payload) {
      scheduleNextPoll(gen, epoch); // extension unavailable — keep waiting
      return;
    }
    if (gen !== flowGen || getReauthEpoch() !== epoch || disposed) return;
    extPhase.value = payload.phase ?? null;
    if (payload.status === 'ok' && payload.accessToken) {
      stopPoll(gen);
      store.finishHandoff(payload.accessToken, epoch); // mandatory epoch at commit
      if (gen !== flowGen || getReauthEpoch() !== epoch || disposed) return;
      proxy().$router?.push('/');
    } else if (payload.status === 'error') {
      if (gen !== flowGen || getReauthEpoch() !== epoch || disposed) return;
      stopPoll(gen);
      extWaiting.value = false;
      extBusy.value = false;
      extMsg.value = payload.message ?? 'Login via extension gagal.';
    } else {
      // {status:'ok', active:true} → still in progress, keep waiting.
      scheduleNextPoll(gen, epoch);
    }
  } finally {
    if (pollInFlightGen === gen) pollInFlightGen = null;
  }
}

function startWaiting(mode: 'auto' | 'semi', epoch: number, gen: number) {
  extWaiting.value = true;
  extMode.value = mode;
  extBusy.value = false;
  // Takeover: the new flow owns the timer — clear any orphaned older timeout
  // unconditionally (new-clears-old is allowed; old-clears-new is blocked by
  // stopPoll's gen guard above).
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  scheduleNextPoll(gen, epoch);
}

async function checkExtension() {
  extChecking.value = true;
  try {
    const installed = await store.isExtensionInstalled();
    if (disposed) return;
    extInstalled.value = installed;
  } finally {
    if (!disposed) extChecking.value = false;
  }
}

onMounted(async () => {
  // YD-AUTH-002: consume a handoff #access_token fragment FIRST — synchronously
  // (no await) and before ANY extension detection/messaging, store write, or
  // navigation — so no async work can run while the secret is still in the URL.
  let fragmentConsumed = false;
  if (store.isHandoffMode) {
    const token = parseFragmentAccessToken(proxy().$route?.hash as string | undefined);
    if (token) {
      fragmentConsumed = true;
      // History hygiene FIRST — synchronously, before any store write or await.
      // Preserve the existing history state object (never null), which keeps
      // history.back() behavior intact; a null state would corrupt it. Scrub is
      // exactly pathname+search: no query residue, no fragment.
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(window.history.state, '', cleanUrl);
      // Current-flow commit (reviewer C exemption, tested): this write runs
      // synchronously with NO await before it — no logout can interleave, so
      // the current epoch IS the owner by construction and no stamp is needed.
      // All ASYNC token paths above/below capture the epoch before their first
      // await and present it mandatorily at the commit boundary.
      store.finishHandoff(token);
      // router.replace re-writes the SAME history entry via vue-router's own
      // replaceState — no extra replaceState call is needed or wanted.
      await proxy().$router?.replace('/');
      if (disposed) return;
      return;
    }
  }
  await checkExtension();
  if (disposed) return;
  // Listen for the extension's final result (posted to the window by the
  // content-script bridge). Handles both success (JWT) and failure/timeout.
  // Epoch ownership (reviewer C): the bridge push arrives asynchronously, so
  // the handler validates it against the flow's origin epoch captured at click
  // time (or the mount epoch when no flow is active). A late pre-logout result
  // arriving after endLogout (epoch bumped, flag down) never commits, never
  // navigates, never mutates overlay. The commit presents the expected epoch
  // mandatorily — finishHandoff's generation guard is the second gate.
  stopListening = store.onExtensionResult((payload: ExtOutboundStatus) => {
    if (disposed) return;
    // YD-AUTH-002: when a handoff #access_token fragment was already consumed
    // above, the extension bridge must not OVERWRITE that newer token with a
    // stale extension 'ok' payload (no competing write).
    if (fragmentConsumed) return;
    const expected = flowEpoch ?? mountEpoch;
    if (getReauthEpoch() !== expected) return; // orphaned by a fully-resolved logout
    if (isLogoutInProgress()) return;
    if (payload?.status === 'ok' && payload.accessToken) {
      const gen = flowGen; // current owner — bridge commits to the live flow
      stopPoll(gen);
      store.finishHandoff(payload.accessToken, expected);
      if (disposed || getReauthEpoch() !== expected) return;
      extWaiting.value = false;
      extBusy.value = false;
      proxy().$router?.push('/');
    } else if (payload?.status === 'error') {
      const gen = flowGen;
      if (getReauthEpoch() !== expected) return;
      stopPoll(gen);
      extWaiting.value = false;
      extBusy.value = false;
      extMsg.value = payload.message ?? 'Login via extension gagal.';
    } else {
      extWaiting.value = false;
      extBusy.value = false;
      stopPoll(flowGen);
    }
  });
  // When the user switches back from the login tab (focus/visibility), do an
  // immediate result check instead of waiting up to the poll interval. The
  // in-flight gate inside pollExtensionResult serializes this against a
  // scheduled tick — they can never overlap.
  const onFocus = () => {
    if (disposed) return;
    if (extWaiting.value) void pollExtensionResult(flowGen, flowEpoch);
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  stopFocusListeners = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
});

onUnmounted(() => {
  disposed = true; // pending reads discard on settle — never mutate after unmount
  flowGen += 1; // invalidate any in-flight tick/bridge result (ownership)
  stopListening?.();
  stopPoll();
  stopFocusListeners?.();
});

async function handleLogin() {
  // Legacy async path (reviewer C): stamp the origin epoch BEFORE the first
  // await and require it at the navigation boundary. store.login enforces the
  // same epoch at its own commit; the view additionally refuses to navigate a
  // late pre-logout success that resolved after endLogout.
  const epoch = getReauthEpoch();
  flowEpoch = epoch;
  flowGen += 1;
  const myGen = flowGen;
  await store.login();
  if (disposed) return;
  if (myGen !== flowGen) return; // superseded by a newer flow — never mutate
  if (getReauthEpoch() !== epoch) return; // logout crossed (possibly fully) — never navigate
  if (isLogoutInProgress()) return;
  if (store.isAuthenticated) {
    await proxy().$router?.push('/');
  }
}

async function handleExtensionLogin() {
  // Normal async handoff (reviewer C): stamp BEFORE the first await, present
  // mandatorily at the commit boundary inside loginViaExtension, and re-guard
  // every post-await overlay/navigation mutation. A late ok resolving after a
  // fully-resolved logout returns 'error' from the store (epoch guard) AND is
  // blocked here from navigating or touching overlay state.
  const epoch = getReauthEpoch();
  flowEpoch = epoch;
  flowGen += 1;
  const myGen = flowGen;
  extBusy.value = true;
  extMsg.value = null;
  const status = await store.loginViaExtension();
  if (disposed) return;
  if (myGen !== flowGen) return; // superseded — a newer click owns the UI now
  if (getReauthEpoch() !== epoch) {
    // Crossed a logout (flag up, or bumped-and-released): never navigate,
    // never start a poll, never claim the overlay. Only clear our own busy
    // flag when no newer flow has taken it (gen already verified above).
    extBusy.value = false;
    return;
  }
  if (isLogoutInProgress()) {
    extBusy.value = false;
    return;
  }
  if (status === 'ok') {
    await proxy().$router?.push('/');
    if (!disposed && myGen === flowGen && getReauthEpoch() === epoch) {
      extBusy.value = false;
    }
    return;
  }
  if (status === 'started') {
    // The background opened a login tab (auto) or waits for explicit "Selesai"
    // confirmation (semi). The bridge result/status poll delivers the JWT.
    startWaiting(store.extensionMode ?? 'auto', epoch, myGen);
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
            <li>jalankan tool capture: <code>node capture-handoff.mjs --api &lt;serverUrl&gt; --app-url &lt;spaUrl&gt;</code></li>
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
