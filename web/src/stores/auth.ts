import { defineStore } from 'pinia';
import { capture, me, getSiapProfile, logoutSession } from '../api/client';
import type { User } from '../types';
import { clearCache } from '../api/cache';
import { useExtension, type ExtOutboundStatus } from '../composables/useExtension';
import { onTokenRefreshed } from '../lib/reauth';
import { beginLogout, endLogout, isLogoutInProgress, getReauthEpoch } from '../lib/logout';

const TOKEN_KEY = 'sso_token';
// Module scope, next to `const TOKEN_KEY = 'sso_token';`:
/** Bound for the best-effort server-side revoke during logout (ms). */
const SERVER_REVOKE_TIMEOUT_MS = 5000;
// SECURITY ASSUMPTION (documented — see security review MEDIUM #8): the JWT is
// stored in localStorage, so any script running in the page context can read it.
// This is accepted because (a) the stored-XSS vector that would exfiltrate it is
// neutralized server-side (Kulon descriptionHtml is sanitized before it reaches
// v-html), and (b) migrating to an httpOnly SameSite cookie or a memory-only +
// refresh flow is a cross-cutting architectural change tracked separately. The
// web origin is restricted to script we ship and CSP further raises the exploit
// bar. Revisit before shipping an untrusted-content rendering path.

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) as string | null,
    user: null as User | null,
    checking: false, // "memeriksa session" / "sedang login" phase
    error: null as string | null,
    hasSiap: false, // SIAP session validity (from GET /me)
    hasKulon: false, // Kulon session validity (from GET /me)
    fotoUrl: null as string | null, // SIAP profile photo (header avatar)
    extensionError: null as string | null,
    extensionMode: 'auto' as 'auto' | 'semi', // how the background drives the login flow
    reauthing: false, // full-screen "Memulihkan sesi…" overlay is visible
    reauthPhase: null as 'sso' | 'kulon' | 'siap' | null, // drives MultiStepLoader step
    reauthAttempted: false, // loop guard: once per expiry event, reset on logout
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    isHandoffMode: () => import.meta.env.VITE_LOGIN_MODE === 'handoff',
  },
  actions: {
    /** Receive the extension's final result posted to the window by the content bridge. */
    onExtensionResult(handler: (payload: ExtOutboundStatus) => void): () => void {
      return useExtension().onResult(handler);
    },
    async login() {
      this.checking = true;
      this.error = null;
      try {
        const result = await capture();
        this.token = result.accessToken;
        localStorage.setItem(TOKEN_KEY, result.accessToken);
        this.hasSiap = result.hasSiap ?? false;
        this.hasKulon = result.hasKulon ?? false;
        // If the session was reused, no browser window was opened.
        if (result.reused) {
          this.error = null;
        } else if (result.hasSso && result.hasKulon) {
          this.error = null;
        } else if (!result.hasKulon) {
          // SSO sukses tapi session Kulon kosong — dashboard mungkin kosong.
          this.error = 'Login SSO berhasil, tapi session Kulon belum lengkap. Beberapa data mungkin kosong.';
        }
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 429) {
          this.error =
            'Terlalu banyak percobaan login. Tunggu sekitar 1 menit lalu coba lagi.';
        } else {
          this.error = 'Gagal login: ' + ((e as Error).message ?? 'Terjadi kesalahan');
        }
      } finally {
        this.checking = false;
      }
    },
    async fetchMe(): Promise<'ok' | 'incomplete' | 'invalid' | 'error'> {
      try {
        this.user = await me();
        this.hasSiap = this.user?.hasSiap ?? false;
        this.hasKulon = this.user?.hasKulon ?? false;
        if (this.user && this.user.complete === false) {
          this.clearSessionState(); // keep browser cookies for silent re-capture
          return 'incomplete';
        }
        // Load the SIAP profile photo for the header avatar (best-effort; the
        // fallback letter stays when SIAP is unavailable or the fetch fails).
        if (this.hasSiap) {
          getSiapProfile()
            .then((profile) => { this.fotoUrl = profile?.fotoUrl ?? null; })
            .catch(() => {});
        }
        return 'ok';
      } catch (e: any) {
        // 401 = invalid JWT: the axios interceptor wipes the token and
        // redirects to /login. Other failures (network/5xx) must NOT bounce —
        // otherwise a downed backend causes a login loop.
        return e?.response?.status === 401 ? 'invalid' : 'error';
      }
    },
    async isExtensionInstalled(): Promise<boolean> {
      const status = await useExtension().readStatus();
      if (status !== null) {
        this.extensionError = null;
        return true;
      }
      this.extensionError = 'Extension tidak terdeteksi atau tidak merespons.';
      return false;
    },
    async loginViaExtension(): Promise<'ok' | 'started' | 'error' | 'not-installed'> {
      this.error = null;
      const resp = await useExtension().sendHandoff();
      if (resp === 'not-installed') {
        this.extensionError = 'Extension tidak terdeteksi. Pastikan ID extension dan origin web benar.';
        return 'not-installed';
      }
      if (resp.status === 'ok' && resp.accessToken) {
        this.finishHandoff(resp.accessToken);
        return 'ok';
      }
      if (resp.status === 'error') {
        this.error = resp.message ?? 'Login via extension gagal.';
        return 'error';
      }
      // status 'started' — the background opened a login tab (auto) or waits for
      // the user to confirm (semi); the view reacts via onResult / status poll.
      if (resp.status === 'started') {
        this.extensionMode = resp.mode ?? 'auto';
        return 'started';
      }
      return 'error';
    },
    /** Pull the current extension state / last result (self-healing poll). */
    async readExtensionResult(): Promise<any | null> {
      return useExtension().readStatus();
    },
    finishHandoff(token: string) {
      if (isLogoutInProgress()) return; // never rewrite a token during logout
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    /** Update the store's JWT after a silent refresh. Called by the axios
     *  interceptor (via emitTokenRefreshed) and by individual actions that
     *  obtain a token from other paths. */
    setToken(token: string) {
      if (isLogoutInProgress()) return; // never rewrite a token during logout
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    /** Clear the JWT/user/foto state WITHOUT asking the extension to wipe
     *  session cookies. Used when the server-side session is incomplete so
     *  the still-valid browser cookies can be silently re-captured. */
    clearSessionState() {
      clearCache();
      this.token = null;
      this.user = null;
      this.fotoUrl = null;
      localStorage.removeItem(TOKEN_KEY);
    },
    /** Poll/onResult wait for an in-flight extension handoff started by
     *  attemptReauth('started'). Resolves once a fresh JWT (recovered) or an
     *  error (failed) arrives. Drives onPhase per read phase. */
    async waitForReauthResult(
      onPhase?: (phase: 'sso' | 'kulon' | 'siap') => void,
    ): Promise<'recovered' | 'failed'> {
      // Capture the reauth epoch at start: if a logout begins while this poll
      // is running, beginLogout() bumps the epoch and every later tick (and
      // the settle path) sees the mismatch and self-cancels — a late extension
      // 'ok'/accessToken result can never resurrect the token after logout.
      const epochAtStart = getReauthEpoch();
      return new Promise<'recovered' | 'failed'>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setInterval> | undefined;
        const isInvalidated = () => getReauthEpoch() !== epochAtStart;
        const settle = (r: 'recovered' | 'failed') => {
          if (settled) return;
          settled = true;
          if (timer) clearInterval(timer);
          this.reauthing = false;
          this.reauthPhase = null;
          resolve(r);
        };
        const attempt = async () => {
          if (isInvalidated()) {
            // Logout began while we were polling: never read the extension,
            // never finishHandoff, never raise the overlay. settle('failed').
            settle('failed');
            return;
          }
          const payload: any = await this.readExtensionResult();
          if (isInvalidated()) {
            // The read crossed a logout boundary: discard whatever came back.
            settle('failed');
            return;
          }
          if (!payload) return; // extension unavailable — keep waiting
          const phase = payload.phase as 'sso' | 'kulon' | 'siap' | undefined;
          if (phase) {
            this.reauthPhase = phase;
            onPhase?.(phase);
          }
          if (payload.accessToken && payload.status !== 'error') {
            this.finishHandoff(payload.accessToken);
            settle('recovered');
          } else if (payload.status === 'error') {
            settle('failed');
          }
          // {status:'ok', active:true} → still in progress; poll continues.
        };
        timer = setInterval(attempt, 3000);
        attempt();
      });
    },
    /** Silent re-auth via the extension after a session expiry. Returns once
     *  a fresh JWT is obtained ('recovered') or on failure/loop-guard ('failed'). */
    async attemptReauth(
      onPhase?: (phase: 'sso' | 'kulon' | 'siap') => void,
    ): Promise<'recovered' | 'failed'> {
      // Never re-auth while a logout is in progress: the logout owns the
      // session teardown and must not race an extension re-capture.
      if (isLogoutInProgress()) return 'failed';
      if (this.reauthAttempted) return 'failed'; // loop guard: once per event
      // Capture the epoch AFTER the entry guards: if a logout begins while the
      // handoff below is in flight, beginLogout() bumps it — the check after
      // the await then fails EVEN IF logout has already fully ended (the flag
      // drops on endLogout, but the epoch stays bumped).
      const epochAtStart = getReauthEpoch();
      const invalidated = () => getReauthEpoch() !== epochAtStart;
      this.reauthAttempted = true;
      this.reauthing = true;
      this.reauthPhase = null;
      const resp = await this.loginViaExtension();
      if (invalidated()) {
        // Logout began while the handoff was in flight (or finished): never
        // mint, never claim recovery, never start a poll.
        this.reauthing = false;
        return 'failed';
      }
      if (resp === 'ok') {
        this.reauthing = false;
        return 'recovered';
      }
      if (resp === 'started') {
        this.reauthPhase = 'sso';
        onPhase?.('sso');
        return this.waitForReauthResult(onPhase);
      }
      this.reauthing = false;
      return 'failed';
    },
    async logout() {
      // Concurrent logout: the first call owns the teardown; every later call
      // while one is in flight early-returns (the shared operation performs
      // the single cleanup and releases the flag in its finally).
      if (isLogoutInProgress()) return;
      // (0) Flag FIRST: every sibling 401 / in-flight refresh success /
      // reauth attempt from this point on is suppressed by the shared
      // logout-in-progress state (client.ts interceptor + this store).
      beginLogout();
      try {
        // (1) Server-side revocation while this JWT still exists and can
        // authenticate the request, BOUNDED: race logoutSession() against a
        // ~5s settle window so a hung backend cannot extend logout. The
        // backend contract (final-corrections Track A §4.3) accepts an
        // expired bearer, so this stays functional for expired local tokens.
        // Network/5xx/401/timeout are best-effort — never block the UI.
        if (this.token) {
          try {
            await Promise.race([
              logoutSession(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('logout server revoke timed out')), SERVER_REVOKE_TIMEOUT_MS),
              ),
            ]);
          } catch {
            // Logout 401 = session already dead (terminal in the interceptor);
            // network/5xx/timeout = backend unreachable or slow. Either way,
            // local cleanup below still proceeds — never enter a refresh-retry
            // on logout.
          }
        }
        // (2) Local wipe + reauth-state reset. The overlay is driven by
        // `reauthing`; if a reauth was in progress (or the interceptor's
        // refresh-failure emitted during the race), logout must tear it down:
        // a logged-out user must never be left under the "Memulihkan sesi…"
        // overlay, and the loop guard is cleared for a future login.
        clearCache();
        this.reauthing = false;
        this.reauthPhase = null;
        this.reauthAttempted = false; // a next expiry event may auto-reauth again
        this.token = null;
        this.user = null;
        this.fotoUrl = null;
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        // (3) Best-effort extension cookie wipe — AWAITED so logout() does not
        // resolve while the wipe is still in flight (useExtension().logout()
        // already swallows messaging errors). endLogout() runs only AFTER the
        // wipe response, in the finally, so the flag can never be released
        // before cleanup settles.
        try {
          await useExtension().logout();
        } finally {
          endLogout();
        }
      }
    },
  },
});

// Module-level subscription to silent refresh events. Keeps the store token
// in sync when the axios interceptor rotates the JWT via emitTokenRefreshed.
// The unsubscribe guard handles HMR: if the module is re-evaluated, the old
// subscription is torn down first so the callback never fires with stale refs.
let _unsubTokenSync: (() => void) | undefined;
if (_unsubTokenSync) {
  _unsubTokenSync();
}
_unsubTokenSync = onTokenRefreshed((token) => {
  // Discard rotations that resolve during logout — never rewrite the store
  // token after logout cleared it.
  if (isLogoutInProgress()) return;
  const store = useAuthStore();
  store.token = token;
});