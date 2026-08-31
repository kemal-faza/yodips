import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // HTTPS preview utk testing kamera dari HP di LAN (npm run preview:https).
    // Saklar env agar build/dev/preview biasa & produksi Vercel tak tersentuh.
    ...(process.env.HTTPS_PREVIEW ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "favicon-192.png",
        "yodips-logo-512.png",
      ],
      manifest: {
        name: "YoDips",
        short_name: "YoDips",
        description:
          "Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.",
        theme_color: "#01637E",
        background_color: "#F7F7F7",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "favicon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "yodips-logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "yodips-logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Match the precached Vite entry exactly; '/' is not a precache key.
        navigateFallback: "index.html",
        // Halaman navigasi /api/* tidak pernah difallback ke shell SPA.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    // reka-ui (via shadcn-vue components such as Button) is a heavy ESM dep;
    // cold-loading it in a jsdom worker can exceed the default 5s under the
    // full parallel suite, so allow more time.
    testTimeout: 20000,
    setupFiles: ["./src/test/setup.ts"],
  },
});
