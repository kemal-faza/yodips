import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const ROOT = import.meta.dirname;

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        background: resolve(ROOT, 'src/background.ts'),
        'content-bridge': resolve(ROOT, 'src/content-bridge.ts'),
        popup: resolve(ROOT, 'src/popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
});
