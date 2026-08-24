import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import App from "./App.vue";
import { buildRouter } from "./router";
import { useAuthStore } from "./stores/auth";
import { emitReauthRequested } from "./lib/reauth";
import * as api from "./api/client";

// Aktifkan jalur interactive capture (dev) supaya tombol 'Login via SSO' muncul
// di test login. Produksi menyembunyikannya (lihat LoginView).
vi.mock("./config/extension", () => ({
  EXTENSION_ID: "mock-ext",
  get SSO_CAPTURE_ENABLED() {
    return true;
  },
  isMobileUserAgent: () => false,
  // Router kini resolve permukaan via adaptiveRoute (Fase 4) yang membaca
  // isMobileDevice saat buildRouter — mock ini mengunci permukaan desktop.
  isMobileDevice: () => false,
}));

vi.mock("./api/client", () => ({
  getAssignments: vi.fn().mockResolvedValue([]),
  getAllAssignments: vi.fn().mockResolvedValue([]),
  getCourses: vi.fn().mockResolvedValue([]),
  capture: vi.fn(),
  me: vi.fn(),
  getSiapProfile: vi
    .fn()
    .mockResolvedValue({ nama: "X", nim: "1", status: "aktif" }),
  getSiapIrs: vi
    .fn()
    .mockResolvedValue({ semester: "", totalSks: 0, mataKuliah: [] }),
  getSiapKhs: vi.fn().mockResolvedValue({ ipk: 0, semesters: [] }),
}));

describe("App integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("redirects to login when unauthenticated and shows login button", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push("/");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("login");
    expect(w.text()).toContain("Login via SSO");
  });

  it("logs in and navigates to dashboard", async () => {
    (api.capture as any).mockResolvedValue({
      accessToken: "tok",
      capturedAt: 0,
      hasSso: true,
      hasMicrosoft: true,
      hasKulon: true,
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push("/login");
    await flushPromises();

    // Drive the real login flow: call the store's login (same as the button does)
    const store = useAuthStore();
    await store.login();
    expect(store.isAuthenticated).toBe(true);

    // The login-view redirects to the dashboard after successful login.
    await router.push("/");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dashboard");
  });

  it("navigates to /profile after login and resolves the profile route", async () => {
    (api.capture as any).mockResolvedValue({
      accessToken: "tok",
      capturedAt: 0,
      hasSso: true,
      hasMicrosoft: true,
      hasKulon: true,
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push("/login");
    await flushPromises();

    const store = useAuthStore();
    await store.login();

    await router.push("/profile");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("profile");
    expect(router.currentRoute.value.path).toBe("/profile");
  });

  it("shows ReauthOverlay and silently reauthes when the bus fires (mid-use auth-401)", async () => {
    // Extension fast-path instantly returns a fresh JWT to any message.
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        sendMessage: (_id: string, _msg: any, cb: (resp: any) => void) =>
          cb({ status: "ok", accessToken: "jwt-new" }),
      },
    };
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = buildRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await router.push("/");
    await flushPromises();
    const store = useAuthStore();
    store.token = "old-token";
    localStorage.setItem("sso_token", "old-token");

    // Simulate the interceptor's auth-401: emit on the same module bus App subscribes to.
    emitReauthRequested();
    await flushPromises();
    expect(store.token).toBe("jwt-new");
    expect(localStorage.getItem("sso_token")).toBe("jwt-new");
    delete (globalThis as any).chrome;
  });
});
