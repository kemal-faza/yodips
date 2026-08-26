import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from './index';

// State auth mock dikontrol per-test: dengan isAuthenticated=true, guard auth
// me-redirect /login → /dashboard, sehingga pass guard kedua (to='/') kena
// branch mobile. Tes /login butuh authed=false agar /login dilayani apa adanya.
const authState = vi.hoisted(() => ({ authed: true }));

vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    isAuthenticated: authState.authed,
    fetchMe: vi.fn(async () => 'ok'),
    attemptReauth: vi.fn(async () => 'recovered'),
  })),
}));

import { isMobileDevice } from '../config/extension';

vi.mock('../config/extension', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMobileDevice: vi.fn(),
}));

const isMobileMock = vi.mocked(isMobileDevice);

function stubReplace() {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  return replace;
}

afterEach(() => {
  vi.unstubAllGlobals();
  isMobileMock.mockReset();
  authState.authed = true;
});

describe('guard UA-mobile → /app/ (transisi F5)', () => {
  it('desktop: /scan, /jadwal, /khs, /irs, /presensi → redirect /', async () => {
    isMobileMock.mockReturnValue(false);
    const replace = stubReplace();
    for (const p of ['/scan', '/jadwal', '/khs', '/irs', '/presensi']) {
      const router = buildRouter(createMemoryHistory());
      await router.push(p);
      await router.isReady();
      expect(router.currentRoute.value.path, p).toBe('/');
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it('mobile UA: rute SPA apa pun di-replace ke /app/', async () => {
    isMobileMock.mockReturnValue(true);
    const replace = stubReplace();
    const router = buildRouter(createMemoryHistory());
    // Catatan: guard me-return false → navigasi ABORTED. Pada abort, isReady()
    // deadlock (markAsReady sudah terpanggil sebelum handler terdaftar dan
    // currentRoute tetap START) — jadi cukup await push (resolve dgn failure).
    await router.push('/');
    expect(replace).toHaveBeenCalledWith('/app/');
  });

  it('mobile UA: /privacy tetap dilayani SPA (halaman publik)', async () => {
    isMobileMock.mockReturnValue(true);
    const replace = stubReplace();
    const router = buildRouter(createMemoryHistory());
    await router.push('/privacy');
    await router.isReady();
    expect(replace).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/privacy');
  });

  it('mobile UA: /login belum diarahkan selama transisi (branch pairing hidup sampai F6)', async () => {
    isMobileMock.mockReturnValue(true);
    authState.authed = false; // tanpa ini, guard auth me-redirect /login → / lalu kena branch mobile
    const replace = stubReplace();
    const router = buildRouter(createMemoryHistory());
    await router.push('/login');
    expect(replace).not.toHaveBeenCalled();
  });
});
