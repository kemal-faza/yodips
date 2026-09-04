import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSwUpdater } from './sw-update';

/**
 * The 2026-09-02 regression: a stale Workbox service worker registered
 * createHandlerBoundToURL("/") (non-precached-url) and survived in
 * long-lived tabs because registerType:"autoUpdate" only swaps the SW when a
 * byte-diff is observed during registration — nothing ever polls update().
 * These tests pin the recovery loop: periodic registration.update() so a
 * fixed sw.js propagates without requiring the user to close the tab.
 */

function makeRegistration(overrides: Partial<ServiceWorkerRegistration> = {}) {
  return {
    active: { postMessage: vi.fn(), state: 'activated' },
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ServiceWorkerRegistration;
}

describe('createSwUpdater', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls registration.update() on an interval so a changed sw.js is picked up', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration();

    createSwUpdater({ registration: reg, intervalMs: 60_000 });

    expect(reg.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reg.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reg.update).toHaveBeenCalledTimes(3);
  });

  it('keeps polling when update() rejects (offline/blocked) — no unhandled rejection loop', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration({ update: vi.fn().mockRejectedValue(new Error('offline')) });
    const onError = vi.fn();

    createSwUpdater({ registration: reg, intervalMs: 60_000, onError });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000); // loop stays alive
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('does not fire update() while stopped', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration();

    const updater = createSwUpdater({ registration: reg, intervalMs: 60_000 });
    updater.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(reg.update).not.toHaveBeenCalled();
  });
});
