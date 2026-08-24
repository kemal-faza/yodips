import { defineAsyncComponent, type Component } from 'vue';
import { isMobileDevice } from '../config/extension';

/** Loader route-level agar code-splitting tiap permukaan tetap terjaga. */
export type ComponentLoader = () => Promise<Component>;

/**
 * Resolusi permukaan sekali-per-mount: perangkat tidak berganti mid-session
 * (resize desktop → reload). `detect` bisa diinjeksi di test.
 */
export function adaptiveRoute(
  desktop: ComponentLoader,
  mobile: ComponentLoader,
  detect: () => boolean = isMobileDevice,
) {
  return defineAsyncComponent(() => (detect() ? mobile() : desktop()));
}
