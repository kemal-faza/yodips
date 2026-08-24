import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import router from './router';
import { useThemeStore } from './stores/theme';
import './assets/css/main.css';

const pinia = createPinia();
createApp(App).use(pinia).use(router).mount('#app');
// Theme store reads the saved/system preference and syncs the `.dark` class
// (the pre-paint FOUC guard in index.html already applied it).
useThemeStore(pinia).init();
registerSW({ immediate: true });
