import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from './index';

// Mock store auth SEBELUM import router: guard beforeEach memanggil
// useAuthStore() (butuh pinia kalau tidak di-mock) dan kasus mobile-pass
// butuh isAuthenticated=true supaya guard auth tidak melempar ke /login.
vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    isAuthenticated: true,
    fetchMe: vi.fn(async () => 'ok'),
    attemptReauth: vi.fn(async () => 'recovered'),
  })),
}));

import { isMobileDevice } from '../config/extension';

function stubStandalone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('standalone'),
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => localStorage.clear());

describe('route mobile-only (desktop redirect /)', () => {
  it('desktop: /scan, /jadwal, /khs, /irs, /presensi → redirect /', async () => {
    stubStandalone(false);
    for (const p of ['/scan', '/jadwal', '/khs', '/irs', '/presensi']) {
      const router = buildRouter(createMemoryHistory());
      await router.push(p);
      await router.isReady();
      expect(router.currentRoute.value.path, p).toBe('/');
    }
  });

  it('mobile UA: /scan tetap /scan', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'iPhone', configurable: true });
    try {
      stubStandalone(false);
      const router = buildRouter(createMemoryHistory());
      await router.push('/scan');
      await router.isReady();
      expect(router.currentRoute.value.path).toBe('/scan');
      expect(isMobileDevice()).toBe(true);
    } finally {
      delete (window.navigator as unknown as Record<string, unknown>).userAgent;
    }
  });

  it('standalone (iPad PWA): /jadwal tetap /jadwal', async () => {
    stubStandalone(true);
    const router = buildRouter(createMemoryHistory());
    await router.push('/jadwal');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/jadwal');
  });
});
