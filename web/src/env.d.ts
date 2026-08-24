/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite/client" />

// Shim untuk editor/LSP berbasis `tsc` polos (tanpa plugin Vue). `vue-tsc`
// (dipakai di `npm run build`/CI) tetap me-resolve `*.vue` secara native dan
// menjadi otoritas type-check; shim ini hanya supaya import `.vue` tidak
// ter-tandai "cannot find module" oleh tooling non-Vue.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}
