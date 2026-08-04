import { defineStore } from 'pinia';
import { capture, me } from '../api/client';
import type { User } from '../types';

const TOKEN_KEY = 'sso_token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) as string | null,
    user: null as User | null,
    checking: false, // "memeriksa session" / "sedang login" phase
    error: null as string | null,
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
        this.error = 'Gagal login: ' + (e as Error).message;
      } finally {
        this.checking = false;
      }
    },
    async fetchMe() {
      try {
        this.user = await me();
      } catch {
        /* 401 handled by interceptor */
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