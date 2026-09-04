import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import router from './router';
import { useThemeStore } from './stores/theme';
import { startSwUpdater } from './lib/sw-update';
import './assets/css/main.css';

const pinia = createPinia();
createApp(App).use(pinia).use(router).mount('#app');
// Theme store reads the saved/system preference and syncs the `.dark` class
// (the pre-paint FOUC guard in index.html already applied it).
useThemeStore(pinia).init();
registerSW({ immediate: true });
// A stale SW (old precache, e.g. non-precached-url "/" regression) survives
// forever under registerType:"autoUpdate" because nothing polls update().
// Poll so a fixed sw.js propagates within one interval. No-op when no SW
// (dev server) or unsupported.
void startSwUpdater({
  navigator,
  intervalMs: 60 * 60 * 1000,
  // Offline/blocked update() is not fatal — keep the loop alive silently.
  onError: () => {},
});
