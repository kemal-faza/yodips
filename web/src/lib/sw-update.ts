/**
 * Service-worker update loop.
 *
 * vite-plugin-pwa with registerType:"autoUpdate" swaps the service worker
 * only when a *new* sw.js byte-diff is observed during registration. It does
 * NOT poll: if a stale sw.js was installed once (e.g. the 2026-09-02
 * non-precached-url regression, where an old precache registered
 * createHandlerBoundToURL("/")), a long-lived tab keeps the stale SW until
 * the next navigation triggers the browser's byte-check.
 *
 * This module polls registration.update() so a changed sw.js is picked up
 * quickly even in tabs that stay open for hours; autoUpdate then activates
 * the new SW automatically. It is pure + injectable (no global reads) so it
 * is jsdom-testable.
 */

/** Minimal structural surface the updater needs — partial mocks type-check. */
export interface SwNavigator {
  serviceWorker: {
    ready: Promise<ServiceWorkerRegistration>;
  };
}

export interface SwUpdaterOptions {
  registration: ServiceWorkerRegistration;
  /** Poll cadence. Default 1h — update() is a cheap HTTP check (ETag). */
  intervalMs?: number;
  /** Swallows poll errors (offline etc.) so the loop never throws unhandled. */
  onError?: (err: unknown) => void;
}

export interface SwUpdaterHandle {
  /** Stop polling. Idempotent. */
  stop: () => void;
}

export function createSwUpdater(options: SwUpdaterOptions): SwUpdaterHandle {
  const {
    registration,
    intervalMs = 60 * 60 * 1000,
    onError = () => {},
  } = options;

  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      await registration.update();
    } catch (err) {
      // Offline/blocked — not fatal, keep the loop alive.
      onError(err);
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Ready-only bootstrap: resolve navigator.serviceWorker.ready, then run the
 * update loop. Returns null when no SW is available (dev server, unsupported).
 */
export async function startSwUpdater(
  options: Omit<SwUpdaterOptions, 'registration'> & { navigator: SwNavigator },
): Promise<SwUpdaterHandle | null> {
  try {
    const registration = await options.navigator.serviceWorker.ready;
    return createSwUpdater({ ...options, registration });
  } catch {
    return null;
  }
}
