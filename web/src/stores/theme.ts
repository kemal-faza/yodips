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
      apply(this.dark);
    },
  },
});
