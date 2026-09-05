import { defineStore } from 'pinia';
import { capture, me, getSiapProfile, logoutSession } from '../api/client';
import type { User } from '../types';
import { clearCache } from '../api/cache';
import {
  isExtOutboundStatus,
  useExtension,
  type ExtOutboundStatus,
  type ExtPollStatus,
} from '../composables/useExtension';
import { onTokenRefreshed } from '../lib/reauth';
import { beginLogout, endLogout, isLogoutInProgress, getReauthEpoch } from '../lib/logout';
import { useKulonStore } from './kulon';

const TOKEN_KEY = 'sso_token';
// Module scope, next to `const TOKEN_KEY = 'sso_token';`:
/** Bound for the best-effort server-side revoke during logout (ms). */
const SERVER_REVOKE_TIMEOUT_MS = 5000;
/** Bound for the best-effort extension cookie wipe during logout (ms). The
 *  wipe is local messaging and should settle fast; a hung extension must never
 *  hold logout (and its flag) open. */
const EXT_WIPE_TIMEOUT_MS = 5000;

type AuthAttempt = { id: number; epoch: number };

let legacyLoginAttempt = 0;
let fetchMeAttempt = 0;
let extensionCheckAttempt = 0;
let extensionLoginAttempt = 0;
let logoutFlight: Promise<void> | null = null;

function clearUserScopedState(state: {
  token: string | null;
  user: User | null;
  fotoUrl: string | null;
  hasSiap: boolean;
  hasKulon: boolean;
}) {
  clearCache();
  state.token = null;
  state.user = null;
  state.fotoUrl = null;
  state.hasSiap = false;
  state.hasKulon = false;
  localStorage.removeItem(TOKEN_KEY);
  useKulonStore().reset();
}

function ownsAttempt(attempt: AuthAttempt, currentId: number): boolean {
  return (
    attempt.id === currentId &&
    attempt.epoch === getReauthEpoch() &&
    !isLogoutInProgress()
  );
}

/** Race a promise against a timeout, clearing the losing timer. When `promise`
 *  wins the timeout is cancelled (no leaked timer); when the timeout wins the
 *  timer already fired and the late `promise` settlement is ignored by the
 *  race (observed, so no unhandled rejection). Callers treat timeout as
 *  best-effort failure. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
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
      const attempt: AuthAttempt = { id: ++legacyLoginAttempt, epoch: getReauthEpoch() };
      if (!ownsAttempt(attempt, legacyLoginAttempt)) return;
      this.checking = true;
      this.error = null;
      try {
        const result = await capture();
        if (!ownsAttempt(attempt, legacyLoginAttempt)) return;
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
        if (!ownsAttempt(attempt, legacyLoginAttempt)) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 429) {
          this.error =
            'Terlalu banyak percobaan login. Tunggu sekitar 1 menit lalu coba lagi.';
        } else {
          this.error = 'Gagal login: ' + ((e as Error).message ?? 'Terjadi kesalahan');
        }
      } finally {
        if (ownsAttempt(attempt, legacyLoginAttempt)) this.checking = false;
      }
    },
    async fetchMe(): Promise<'ok' | 'incomplete' | 'invalid' | 'error'> {
      const attempt: AuthAttempt = { id: ++fetchMeAttempt, epoch: getReauthEpoch() };
      if (!ownsAttempt(attempt, fetchMeAttempt)) return 'error';
      try {
        const user = await me();
        if (!ownsAttempt(attempt, fetchMeAttempt)) return 'error';
        this.user = user;
        this.hasSiap = this.user?.hasSiap ?? false;
        this.hasKulon = this.user?.hasKulon ?? false;
        this.fotoUrl = null;
        if (this.user && this.user.complete === false) {
          this.clearSessionState(); // keep browser cookies for silent re-capture
          return 'incomplete';
        }
        // Load the SIAP profile photo for the header avatar (best-effort; the
        // fallback letter stays when SIAP is unavailable or the fetch fails).
        if (this.hasSiap) {
          getSiapProfile()
            .then((profile) => {
              if (ownsAttempt(attempt, fetchMeAttempt)) {
                this.fotoUrl = profile?.fotoUrl ?? null;
              }
            })
            .catch(() => {});
        }
        return 'ok';
      } catch (e: any) {
        if (!ownsAttempt(attempt, fetchMeAttempt)) return 'error';
        // 401 = invalid JWT: the axios interceptor wipes the token and
        // redirects to /login. Other failures (network/5xx) must NOT bounce —
        // otherwise a downed backend causes a login loop.
        return e?.response?.status === 401 ? 'invalid' : 'error';
      }
    },
    async isExtensionInstalled(): Promise<boolean> {
      const attempt: AuthAttempt = { id: ++extensionCheckAttempt, epoch: getReauthEpoch() };
      if (!ownsAttempt(attempt, extensionCheckAttempt)) return false;
      let status: Awaited<ReturnType<ReturnType<typeof useExtension>['readStatus']>>;
      try {
        status = await useExtension().readStatus();
      } catch {
        if (ownsAttempt(attempt, extensionCheckAttempt)) {
          this.extensionError = 'Extension tidak terdeteksi atau tidak merespons.';
        }
        return false;
      }
      if (!ownsAttempt(attempt, extensionCheckAttempt)) return false;
      if (status !== null) {
        this.extensionError = null;
        return true;
      }
      this.extensionError = 'Extension tidak terdeteksi atau tidak merespons.';
      return false;
    },
    async loginViaExtension(): Promise<'ok' | 'started' | 'error' | 'not-installed'> {
      const attempt: AuthAttempt = { id: ++extensionLoginAttempt, epoch: getReauthEpoch() };
      if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
      this.error = null;
      let resp: Awaited<ReturnType<ReturnType<typeof useExtension>['sendHandoff']>>;
      try {
        resp = await useExtension().sendHandoff();
      } catch {
        if (ownsAttempt(attempt, extensionLoginAttempt)) {
          this.error = 'Login via extension gagal.';
        }
        return 'error';
      }
      // Every response branch below is owned by the same attempt and epoch.
      // A stale response must return without touching the newer attempt's UI.
      if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
      if (resp === 'not-installed') {
        if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
        this.extensionError = 'Extension tidak terdeteksi. Pastikan ID extension dan origin web benar.';
        return 'not-installed';
      }
      if (!isExtOutboundStatus(resp)) {
        this.error = 'Login via extension gagal.';
        return 'error';
      }
      if (resp.status === 'ok' && resp.accessToken) {
        if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
        this.finishHandoff(resp.accessToken, attempt.epoch);
        return 'ok';
      }
      if (resp.status === 'error') {
        if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
        this.error = resp.message ?? 'Login via extension gagal.';
        return 'error';
      }
      // status 'started' — the background opened a login tab (auto) or waits for
      // the user to confirm (semi); the view reacts via onResult / status poll.
      if (resp.status === 'started') {
        if (!ownsAttempt(attempt, extensionLoginAttempt)) return 'error';
        this.extensionMode = resp.mode ?? 'auto';
        return 'started';
      }
      return 'error';
    },
    /** Pull the current extension state / last result (self-healing poll). */
    async readExtensionResult(): Promise<ExtPollStatus | null> {
      return useExtension().readStatus();
    },
    finishHandoff(token: string, expectedEpoch?: number) {
      if (isLogoutInProgress()) return; // never rewrite a token during logout
      // Generation guard: when the caller stamps an origin epoch (reauth
      // handoff, status poll), a mismatch means a logout fully resolved after
      // the handoff was sent — the flag is already down, but the token must
      // still never be written.
      if (expectedEpoch !== undefined && expectedEpoch !== getReauthEpoch()) return;
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    /** Update the store's JWT after a silent refresh. Called by the axios
     *  interceptor (via emitTokenRefreshed) and by individual actions that
     *  obtain a token from other paths. */
    setToken(token: string, expectedEpoch?: number) {
      if (isLogoutInProgress()) return; // never rewrite a token during logout
      if (expectedEpoch !== undefined && expectedEpoch !== getReauthEpoch()) return;
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    /** Clear the JWT/user/foto state WITHOUT asking the extension to wipe
     *  session cookies. Used when the server-side session is incomplete so
     *  the still-valid browser cookies can be silently re-captured. */
    clearSessionState() {
      clearUserScopedState(this);
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
        // Serialization gate (reviewer D): setInterval ticks can overlap when a
        // read hangs past 3s. A second tick arriving while one is pending must
        // NOT start a second read — it returns early so reads never overlap and
        // late resolutions cannot apply out of order.
        let inFlight = false;
        const isInvalidated = () => getReauthEpoch() !== epochAtStart;
        const settle = (r: 'recovered' | 'failed') => {
          if (settled) return;
          settled = true;
          if (timer) clearInterval(timer);
          // Ownership-stamped settle: only the epoch owner clears the overlay
          // state. A stale poll (logout bumped the epoch, possibly fully
          // resolved, and a NEWER attempt now owns reauthing/phase) resolves
          // without touching the newer owner's state.
          if (getReauthEpoch() === epochAtStart) {
            this.reauthing = false;
            this.reauthPhase = null;
          }
          resolve(r);
        };
        const attempt = async () => {
          if (settled) return; // already resolved — never read or mutate again
          if (isInvalidated()) {
            // Logout began while we were polling: never read the extension,
            // never finishHandoff, never raise the overlay. settle('failed').
            settle('failed');
            return;
          }
          if (inFlight) return; // serialize: a read is already pending
          inFlight = true;
          try {
            const payload = await this.readExtensionResult();
            // After EVERY await: re-check settled, ownership (epoch), before
            // any phase/token/overlay mutation — a logout or a newer owner may
            // have crossed while we were awaiting.
            if (settled) return;
            if (isInvalidated()) {
              // The read crossed a logout boundary: discard whatever came back.
              settle('failed');
              return;
            }
            if (!payload) return; // extension unavailable — keep waiting
            const phase = payload.status === 'ok' ? payload.phase : undefined;
            if (phase) {
              if (settled || isInvalidated()) {
                if (isInvalidated() && !settled) settle('failed');
                return;
              }
              this.reauthPhase = phase;
              onPhase?.(phase);
            }
            if (settled || isInvalidated()) {
              if (isInvalidated() && !settled) settle('failed');
              return;
            }
            if (payload.status === 'ok' && payload.accessToken) {
              this.finishHandoff(payload.accessToken, epochAtStart);
              settle('recovered');
            } else if (payload.status === 'error') {
              settle('failed');
            }
            // {status:'ok', active:true} → still in progress; poll continues.
          } catch {
            if (!settled) settle('failed');
          } finally {
            inFlight = false;
          }
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
      const ownsReauthState = () => !invalidated() && !isLogoutInProgress();
      this.reauthAttempted = true;
      this.reauthing = true;
      this.reauthPhase = null;
      try {
        const resp = await this.loginViaExtension();
        if (invalidated()) {
          // Logout began while the handoff was in flight (or FULLY finished —
          // flag already down, epoch bumped): never mint (the handoff boundary
          // above already refused the write), never claim recovery, never start
          // a poll — and never touch reauthing/phase, which the logout cleared
          // or a NEWER attempt now owns.
          return 'failed';
        }
        if (resp === 'ok') return 'recovered';
        if (resp === 'started') {
          this.reauthPhase = 'sso';
          onPhase?.('sso');
          return await this.waitForReauthResult(onPhase);
        }
        return 'failed';
      } catch {
        return 'failed';
      } finally {
        // A handoff failure or malformed response must not strand the overlay.
        // `return await` above keeps this owner alive until the polling promise
        // settles, while the epoch guard prevents an old attempt from clearing
        // a newer owner's state.
        if (ownsReauthState()) {
          this.reauthing = false;
          this.reauthPhase = null;
        }
      }
    },
    logout(): Promise<void> {
      // All callers share the same full teardown. In particular, a concurrent
      // caller must not resolve before the server revoke/local wipe/extension
      // wipe owned by the first caller have completed.
      if (logoutFlight) return logoutFlight;
      // (0) Flag FIRST: every sibling 401 / in-flight refresh success /
      // reauth attempt from this point on is suppressed by the shared
      // logout-in-progress state (client.ts interceptor + this store).
      beginLogout();
      const flight = (async () => {
        try {
        // (1) Server-side revocation while this JWT still exists and can
        // authenticate the request, BOUNDED: race logoutSession() against a
        // ~5s settle window so a hung backend cannot extend logout. The
        // backend contract (final-corrections Track A §4.3) accepts an
        // expired bearer, so this stays functional for expired local tokens.
        // Network/5xx/401/timeout are best-effort — never block the UI.
        // withTimeout clears the losing timer on settle (no leaked timeout).
        if (this.token) {
          try {
            await withTimeout(logoutSession(), SERVER_REVOKE_TIMEOUT_MS, 'logout server revoke timed out');
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
        this.clearSessionState();
        this.reauthing = false;
        this.reauthPhase = null;
        this.reauthAttempted = false; // a next expiry event may auto-reauth again
        this.checking = false;
        this.error = null;
        this.extensionError = null;
        this.extensionMode = 'auto';
        } finally {
        // (3) Best-effort extension cookie wipe — AWAITED but BOUNDED so
        // logout() always releases: race the wipe against EXT_WIPE_TIMEOUT_MS
        // (withTimeout clears the losing timer). A hung extension (callback
        // never fires) resolves via timeout; messaging errors and the timeout
        // itself are swallowed — the wipe stays best-effort. endLogout() runs
        // only AFTER the wipe settles or times out, in the finally, so the
        // flag can never be released before cleanup settles nor held open by
        // a hung wipe.
        try {
          await withTimeout(useExtension().logout(), EXT_WIPE_TIMEOUT_MS, 'logout extension wipe timed out').catch(() => {});
        } finally {
          endLogout();
        }
      }
      })();
      logoutFlight = flight;
      // Identity-guarded release: a later operation can never clear a newer
      // shared flight's slot. The rejection handler prevents an unhandled
      // promise from this bookkeeping branch while preserving the caller's
      // original result.
      void flight.then(
        () => { if (logoutFlight === flight) logoutFlight = null; },
        () => { if (logoutFlight === flight) logoutFlight = null; },
      );
      return flight;
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
