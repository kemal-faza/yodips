import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // reka-ui (via shadcn-vue components such as Button) is a heavy ESM dep;
    // cold-loading it in a jsdom worker can exceed the default 5s under the
    // full parallel suite, so allow more time.
    testTimeout: 20000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
