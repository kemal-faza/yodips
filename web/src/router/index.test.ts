import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { buildRouter } from './index';
import { isHandoffAccessTokenHash } from '../lib/handoff-token';

// vitest 4 does not export a `flushPromises` import; use a local helper.
const flushPromises = async () => {
  await new Promise((r) => setTimeout(r, 0));
};

vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(),
}));

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('redirects unauthenticated user to /login', async () => {
    const store = { isAuthenticated: false, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('serves the public privacy route without authentication', async () => {
    const store = { isAuthenticated: false, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/privacy');
    expect(router.currentRoute.value.path).toBe('/privacy');
    expect(router.currentRoute.value.name).toBe('privacy');
  });

  it('proceeds immediately (non-blocking) and reauths on incomplete', async () => {
    const store = {
      isAuthenticated: true,
      // mirror the real fetchMe: on 'incomplete' it wipes the token
      // (clearSessionState), which flips isAuthenticated false.
      fetchMe: vi.fn(async () => {
        store.isAuthenticated = false;
        return 'incomplete';
      }),
      attemptReauth: vi.fn().mockResolvedValue('recovered'),
      logout: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(store.attemptReauth).toHaveBeenCalled();
  });

  it('falls back to /login?reason=incomplete when reauth fails', async () => {
    const store = {
      isAuthenticated: true,
      fetchMe: vi.fn(async () => {
        store.isAuthenticated = false;
        return 'incomplete';
      }),
      attemptReauth: vi.fn().mockResolvedValue('failed'),
      logout: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.reason).toBe('incomplete');
  });

  it('allows authenticated user to dashboard', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('resolves the profile route', async () => {
    const store = {
      isAuthenticated: true,
      fetchMe: vi.fn().mockResolvedValue('ok'),
      attemptReauth: vi.fn(),
    };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('profile');
  });
});

describe('router guard + handoff fragment (YD-AUTH-002)', () => {
  // Strict three-segment base64url JWT fixture (same shape the capture tool's
  // #access_token fragment delivers). See helper unit tests below.
  const GOOD_TOKEN = 'AAA.BBB.CCC';

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('RED: authenticated user with a valid #access_token= fragment on /login is NOT redirected to dashboard', async () => {
    // Simulate an old-but-still-present local JWT (the store read it from
    // localStorage on boot): isAuthenticated=true. The handoff visit must NOT
    // be bounced — the fragment carries a NEWER token LoginView must consume.
    const store = { isAuthenticated: true, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push(`/login#access_token=${GOOD_TOKEN}`);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.hash).toBe(`#access_token=${GOOD_TOKEN}`);
  });

  it('RED: a malformed handoff hash on /login does NOT bypass the authenticated redirect', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/login#access_token=not-a-jwt');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('RED: an authenticated user on /login WITHOUT a handoff hash is still redirected to dashboard', async () => {
    const store = { isAuthenticated: true, fetchMe: vi.fn(), attemptReauth: vi.fn() };
    (useAuthStore as any).mockReturnValue(store);
    const router = buildRouter(createMemoryHistory());
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('the guard predicate reuses the shared strict-shape handoff hash helper', () => {
    // The guard gates on this exact helper — a valid strict-shape hash must
    // classify true (reaching LoginView), malformed ones false (still bounced).
    const GOOD_TOKEN = 'AAA.BBB.CCC';
    expect(isHandoffAccessTokenHash(`#access_token=${GOOD_TOKEN}`)).toBe(true);
    expect(isHandoffAccessTokenHash('#access_token=not-a-jwt')).toBe(false);
    expect(isHandoffAccessTokenHash('#access_token=')).toBe(false);
    expect(isHandoffAccessTokenHash('#access_token=aaa.bbb.c cc')).toBe(false);
    expect(isHandoffAccessTokenHash('')).toBe(false);
    expect(isHandoffAccessTokenHash(undefined)).toBe(false);
  });
});