import { defineStore } from 'pinia';

const STORAGE_KEY = 'sso_theme';

function storedPreference(): 'dark' | 'light' | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' || saved === 'light' ? saved : null;
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Wipe tema butuh View Transitions API (belum ada di semua browser) dan harus
 * dihormati saat pengguna meminta reduced motion — dua-duanya jatuh ke
 * ganti-tema instan tanpa animasi.
 */
function canWipe(): boolean {
  return (
    typeof document.startViewTransition === 'function' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
  );
}

/**
 * Terapkan tema sebagai wipe kiri → kanan. Snapshot "baru" (tema tujuan)
 * ditumpuk di atas snapshot lama lalu dibuka lewat clip-path, jadi perpindahan
 * temanya terbaca sebagai gerakan, bukan kedipan. Ganti kelasnya sendiri
 * dilakukan di dalam callback supaya View Transitions menangkap before/after
 * yang benar.
 */
function applyWithWipe(dark: boolean) {
  const transition = document.startViewTransition(() => apply(dark));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: ['inset(0 100% 0 0)', 'inset(0 0 0 0)'] },
        {
          duration: 420,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {
      // Snapshot dibatalkan (mis. tab di background) — tema sudah terpasang.
    });
}

/**
 * Dark-mode theme state. Default = saved preference, else the OS
 * prefers-color-scheme. `init()` syncs it onto <html> at boot (the index.html
 * FOUC guard already applied the class pre-paint); `toggle()` flips, persists
 * to localStorage and re-applies.
 */
export const useThemeStore = defineStore('theme', {
  state: () => {
    const pref = storedPreference();
    return { dark: pref !== null ? pref === 'dark' : systemPrefersDark() };
  },
  actions: {
    init() {
      apply(this.dark);
    },
    toggle() {
      this.dark = !this.dark;
      localStorage.setItem(STORAGE_KEY, this.dark ? 'dark' : 'light');
      if (canWipe()) applyWithWipe(this.dark);
      else apply(this.dark);
    },
  },
});
