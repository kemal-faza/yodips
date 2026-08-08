import { defineStore } from 'pinia';
import { capture, me, getSiapProfile } from '../api/client';
import type { User } from '../types';
import { useExtension, type ExtOutboundStatus } from '../composables/useExtension';

const TOKEN_KEY = 'sso_token';

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
          this.error = 'Login SSO berhasil, tapi session Kulon belum lengkap — beberapa data mungkin kosong.';
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
          this.logout();
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
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    logout() {
      this.token = null;
      this.user = null;
      this.fotoUrl = null;
      localStorage.removeItem(TOKEN_KEY);
      // Best-effort: ask the extension to clear the SSO/Kulon/SIAP session
      // cookies so the next login cannot fast-path-reuse a stale session and is
      // forced to open a fresh tab. Never blocks or throws the UI.
      useExtension().logout();
    },
  },
});