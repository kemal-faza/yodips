import { defineStore } from 'pinia';
import { capture, me } from '../api/client';
import type { User } from '../types';
import { EXTENSION_ID } from '../config/extension';

const TOKEN_KEY = 'sso_token';

/** Kirim pesan ke extension. Mengecek chrome.runtime tersedia, membungkus
 *  callback chrome style ke Promise. Bisa melempar bila ekstensi tak terpasang
 *  (sendMessage throw synchronously tanpa receiver). */
async function sendToExtension(message: Record<string, unknown>): Promise<any> {
  const rt = (globalThis as any).chrome?.runtime;
  if (!rt?.sendMessage || !EXTENSION_ID) {
    throw new Error('Extension tidak tersedia');
  }
  return new Promise((resolve, reject) => {
    rt.sendMessage(EXTENSION_ID, message, (resp: any) => {
      if (rt.lastError) reject(new Error(rt.lastError.message));
      else resolve(resp);
    });
  });
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) as string | null,
    user: null as User | null,
    checking: false, // "memeriksa session" / "sedang login" phase
    error: null as string | null,
    hasSiap: false, // SIAP session validity (from GET /me)
    hasKulon: false, // Kulon session validity (from GET /me)
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    isHandoffMode: () => import.meta.env.VITE_LOGIN_MODE === 'handoff',
  },
  actions: {
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
        return 'ok';
      } catch (e: any) {
        // 401 = invalid JWT: the axios interceptor wipes the token and
        // redirects to /login. Other failures (network/5xx) must NOT bounce —
        // otherwise a downed backend causes a login loop.
        return e?.response?.status === 401 ? 'invalid' : 'error';
      }
    },
    async isExtensionInstalled(): Promise<boolean> {
      try {
        const resp = await sendToExtension({ action: 'ping' });
        return resp?.status === 'ok';
      } catch {
        return false;
      }
    },

    async loginViaExtension(): Promise<'ok' | 'need-login' | 'error' | 'not-installed'> {
      this.error = null;
      try {
        const resp = await sendToExtension({ action: 'handoff' });
        if (resp?.status === 'ok' && resp.accessToken) {
          this.finishHandoff(resp.accessToken);
          return 'ok';
        }
        if (resp?.status === 'need-login') {
          // UI menampilkan pesan sendiri; error store tetap null (bersih dari error lama).
          return 'need-login';
        }
        this.error = resp?.message ?? 'Login via extension gagal.';
        return 'error';
      } catch {
        return 'not-installed';
      }
    },

    finishHandoff(token: string) {
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
    },
  },
});