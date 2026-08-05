import { describe, expect, it, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useThemeStore } from './theme';

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    setActivePinia(createPinia());
  });

  it('defaults to light when no preference is stored and no system dark preference', () => {
    const store = useThemeStore();
    expect(store.dark).toBe(false);
  });

  it('defaults to dark from localStorage and applies the class on init', () => {
    localStorage.setItem('sso_theme', 'dark');
    const store = useThemeStore();
    expect(store.dark).toBe(true);
    store.init();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('init applies light (no class) when the stored theme is light', () => {
    localStorage.setItem('sso_theme', 'light');
    const store = useThemeStore();
    store.init();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('toggle flips, persists and applies the class', () => {
    const store = useThemeStore(); // light default
    store.toggle();
    expect(store.dark).toBe(true);
    expect(localStorage.getItem('sso_theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    store.toggle();
    expect(store.dark).toBe(false);
    expect(localStorage.getItem('sso_theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
