import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import LoginView from "./LoginView.vue";
import { useAuthStore } from "../stores/auth";

vi.mock("../stores/auth", () => ({ useAuthStore: vi.fn() }));

// Konfigurasi module di-mock agar tiap test bisa mengendalikan apakah jalur
// /sso/capture diaktifkan dan apakah user-agent = seluler.
const cfg = vi.hoisted(() => ({
  ssoCaptureEnabled: true,
  mobile: false,
}));
vi.mock("../config/extension", () => ({
  EXTENSION_ID: "mock-extension-id",
  get SSO_CAPTURE_ENABLED() {
    return cfg.ssoCaptureEnabled;
  },
  isMobileUserAgent: () => cfg.mobile,
}));

function makeStore(overrides: Record<string, any> = {}) {
  const store = {
    login: vi.fn().mockResolvedValue(undefined),
    loginViaExtension: vi.fn().mockResolvedValue("started"),
    isExtensionInstalled: vi.fn().mockResolvedValue(false),
    finishHandoff: vi.fn(),
    onExtensionResult: vi.fn().mockReturnValue(() => {}),
    readExtensionResult: vi.fn().mockResolvedValue({ status: "active" }),
    extensionMode: "auto",
    checking: false,
    error: null,
    isHandoffMode: false,
    ...overrides,
  };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe("LoginView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Default utk sebagian besar test lama: jalur capture aktif, bukan HP.
    cfg.ssoCaptureEnabled = true;
    cfg.mobile = false;
  });

  it("renders login button", () => {
    makeStore();
    const w = mount(LoginView);
    expect(w.text()).toContain("Memeriksa");
    expect(w.text()).not.toContain("Login via SSO");
  });

  it("does not expose the legacy SSO capture button while extension detection is pending", async () => {
    let resolveDetection!: (value: boolean) => void;
    const detection = new Promise<boolean>((resolve) => {
      resolveDetection = resolve;
    });
    makeStore({ isExtensionInstalled: vi.fn().mockReturnValue(detection) });
    const w = mount(LoginView);
    expect(w.text()).toContain("Memeriksa");
    expect(w.find("button").attributes("disabled")).toBeDefined();
    expect(w.text()).not.toContain("Login via SSO");
    resolveDetection(false);
    await flushPromises();
    expect(w.text()).toContain("Login via SSO");
  });

  it("hides the interactive Login via SSO button when the extension is installed", async () => {
    makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(true) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).not.toContain("Login via SSO");
  });

  it("keeps the interactive Login via SSO button when the extension is not installed", async () => {
    makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(false) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).toContain("Login via SSO");
  });

  it("hides the interactive SSO capture button when capture is disabled (production default)", async () => {
    cfg.ssoCaptureEnabled = false;
    makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(false) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).not.toContain("Login via SSO");
    expect(w.text()).toContain("Pasang di Chrome/Edge");
  });

  it("explains how to fix an undetected extension before falling back to SSO", async () => {
    makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(false),
      extensionError: "Extension tidak terdeteksi.",
    });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).toContain("Extension tidak terdeteksi.");
    expect(w.text()).toContain("VITE_EXTENSION_ID");
  });

  it("calls store.login on button click", async () => {
    const store = makeStore();
    const w = mount(LoginView);
    await flushPromises();
    await w.find("button").trigger("click");
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
  });

  it("shows error message when login fails", () => {
    makeStore({ error: "Gagal login" });
    const w = mount(LoginView);
    expect(w.text()).toContain("Gagal login");
  });

  it("shows interactive login hint while checking", () => {
    makeStore({ checking: true });
    const w = mount(LoginView);
    expect(w.text()).toContain("selesaikan login di window browser");
  });

  it("handoff mode with #access_token= calls finishHandoff once and replaces history (never push)", async () => {
    const store = makeStore({ isHandoffMode: true });
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: {
            hash: "#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-1_2-3",
            query: {},
          },
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledTimes(1);
    expect(store.finishHandoff).toHaveBeenCalledWith(
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-1_2-3",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
    w.unmount();
  });

  it("handoff mode without token shows capture instructions", () => {
    makeStore({ isHandoffMode: true });
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: { query: {}, hash: "" },
          $router: { push: vi.fn() },
        },
      },
    });
    expect(w.text()).toContain("jalankan tool capture");
  });

  it("handoff mode instruction includes the mandatory --app-url <spaUrl> flag", () => {
    makeStore({ isHandoffMode: true });
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: { query: {}, hash: "" },
          $router: { push: vi.fn() },
        },
      },
    });
    // Rendered text() decodes HTML entities, so <spaUrl> appears literally.
    expect(w.text()).toContain("--app-url <spaUrl>");
    // The flag is mandatory: no bracketed/optional form may remain.
    expect(w.text()).not.toContain("--app-url [<spaUrl>]");
    expect(w.text()).not.toContain("--app-url &lt;spaUrl&gt;]");
  });

  it("shows an incomplete-session notice when reason=incomplete", () => {
    makeStore();
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: { query: { reason: "incomplete" } },
          $router: { push: vi.fn() },
        },
      },
    });
    expect(w.text()).toContain("belum lengkap");
  });

  it("shows Login via Extension button and registers the result listener when installed", async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).toContain("Login via Extension");
    expect(store.onExtensionResult).toHaveBeenCalled();
  });

  it("hides Login via Extension button when not installed", async () => {
    makeStore({ isExtensionInstalled: vi.fn().mockResolvedValue(false) });
    const w = mount(LoginView);
    await flushPromises();
    expect(w.text()).not.toContain("Login via Extension");
  });

  it("calls loginViaExtension and routes home when it returns ok", async () => {
    const router = { push: vi.fn() };
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("ok"),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    expect(store.loginViaExtension).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("shows waiting notice when loginViaExtension returns started", async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    expect(w.text()).toContain("tab akan ditutup otomatis");
  });

  it("polls the extension result while waiting and finishes handoff when it returns ok", async () => {
    vi.useFakeTimers();
    const router = { push: vi.fn() };
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
      readExtensionResult: vi.fn().mockResolvedValue({ status: "active" }),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    // First poll returns active → keeps waiting, no finish yet.
    store.readExtensionResult.mockResolvedValue({
      status: "ok",
      accessToken: "jwt-poll",
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.readExtensionResult).toHaveBeenCalled();
    expect(store.finishHandoff).toHaveBeenCalledWith("jwt-poll");
    expect(router.push).toHaveBeenCalledWith("/");
    vi.useRealTimers();
  });

  it("stops polling and shows the error when the extension result poll returns an error", async () => {
    vi.useFakeTimers();
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
      readExtensionResult: vi
        .fn()
        .mockResolvedValue({ status: "error", message: "Login belum selesai" }),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);
    expect(w.text()).toContain("Login belum selesai");
    const callsBefore = (store.readExtensionResult as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect((store.readExtensionResult as any).mock.calls.length).toBe(
      callsBefore,
    );
    vi.useRealTimers();
  });

  it('shows the "Selesai login" confirm button when the extension runs in semi mode', async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
      extensionMode: "semi",
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Selesai login");
  });

  it("shows the auto-mode waiting notice when the extension runs in auto mode", async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
      // extensionMode defaults to 'auto' in makeStore
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    expect(w.text()).toContain("tab akan ditutup otomatis");
  });

  it("finishes handoff when the extension posts an ok result to the window", async () => {
    const router = { push: vi.fn() };
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: router } },
    });
    await flushPromises();
    // Capture the handler registered by onExtensionResult, then invoke it.
    const handler = (store.onExtensionResult as any).mock.calls[0][0];
    handler({ status: "ok", accessToken: "jwt-win" });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledWith("jwt-win");
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("shows the error message when the extension posts an error result", async () => {
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    const handler = (store.onExtensionResult as any).mock.calls[0][0];
    handler({ status: "error", message: "Login belum selesai" });
    await flushPromises();
    expect(w.text()).toContain("Login belum selesai");
  });

  it("maps the extension phase to the loader active step", async () => {
    vi.useFakeTimers();
    const store = makeStore({
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
      loginViaExtension: vi.fn().mockResolvedValue("started"),
      readExtensionResult: vi
        .fn()
        .mockResolvedValue({ status: "active", phase: "kulon" }),
    });
    const w = mount(LoginView, {
      global: { mocks: { $route: { query: {} }, $router: { push: vi.fn() } } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().includes("Login via Extension"))!
      .trigger("click");
    await flushPromises();
    // Let the poll run once so extPhase is set from the payload → step 1 (Kulon) active.
    await vi.advanceTimersByTimeAsync(4000);
    // step 0 (SSO) done → check icon; step 1 (Kulon) active → spinner
    const svgs = w.findAll("svg");
    expect(svgs[0].classes().join(" ")).toContain("lucide-circle-check");
    expect(svgs[1].classes().join(" ")).toContain("lucide-loader-circle");
    vi.useRealTimers();
  });

  });

describe("LoginView fragment handoff (YD-AUTH-002)", () => {
  // Valid-looking strict three-segment JWT (header.payload.signature),
  // base64url-safe. Same shape the capture tool's #access_token delivers.
  const GOOD_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-1_2-3";
  const GOOD_HASH = `#access_token=${GOOD_TOKEN}`;
  const makeRoute = (hash: string, query: Record<string, unknown> = {}) => ({
    hash,
    query,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cfg.ssoCaptureEnabled = true;
    cfg.mobile = false;
  });

  it("scrubs the URL first (history.state preserved), then finishHandoff, then router.replace (never push)", async () => {
    const store = makeStore({ isHandoffMode: true });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute(GOOD_HASH),
          $router: router,
        },
      },
    });
    await flushPromises();
    // Scrub happens BEFORE any store write: replaceState precedes finishHandoff.
    const rsIndex = replaceState.mock.invocationCallOrder[0];
    const fhIndex = store.finishHandoff.mock.invocationCallOrder[0];
    expect(rsIndex).toBeLessThan(fhIndex);
    // Scrub is EXACT: pathname + search only (no token, no other query/hash
    // residue), and the existing history state object is preserved (never null).
    const { pathname, search } = window.location;
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      `${pathname}${search}`,
    );
    expect(store.finishHandoff).toHaveBeenCalledWith(GOOD_TOKEN);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });

  it("scrubs the fragment BEFORE extension detection/messaging when the extension is installed", async () => {
    const store = makeStore({
      isHandoffMode: true,
      isExtensionInstalled: vi.fn().mockResolvedValue(true),
    });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute(GOOD_HASH),
          $router: router,
        },
      },
    });
    await flushPromises();
    // replaceState fires BEFORE any extension detection/messaging call and
    // before any store write.
    const rsOrder = replaceState.mock.invocationCallOrder[0];
    const extCheckOrder = store.isExtensionInstalled.mock.invocationCallOrder[0];
    const extListenOrder = store.onExtensionResult.mock.invocationCallOrder[0];
    const fhOrder = store.finishHandoff.mock.invocationCallOrder[0];
    expect(rsOrder).toBeLessThan(extCheckOrder);
    expect(rsOrder).toBeLessThan(extListenOrder);
    expect(rsOrder).toBeLessThan(fhOrder);
    expect(store.finishHandoff).toHaveBeenCalledWith(GOOD_TOKEN);
    expect(router.replace).toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });

  it("a late extension 'ok' result cannot overwrite the fragment-consume token or re-scrub", async () => {
    // Fragment-consume path finishes handoff synchronously (before the
    // extension listener is even registered). A subsequent extension 'ok'
    // (different token) would be a competing write — assert it does NOT
    // overwrite the fragment token (no double-write, no second scrub).
    const store = makeStore({ isHandoffMode: true, token: null });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute(GOOD_HASH),
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledWith(GOOD_TOKEN);
    const goodCalls = store.finishHandoff.mock.calls.length;
    const scrubCalls = replaceState.mock.calls.length;
    // The extension posts an 'ok' with a DIFFERENT token after mount.
    const handler = (store.onExtensionResult as any).mock.calls[0][0];
    handler({ status: "ok", accessToken: "ext.jwt.other" });
    await flushPromises();
    expect(store.finishHandoff).toHaveBeenCalledTimes(goodCalls);
    expect(store.finishHandoff).not.toHaveBeenCalledWith("ext.jwt.other");
    expect(replaceState).toHaveBeenCalledTimes(scrubCalls);
    replaceState.mockRestore();
    w.unmount();
  });

  it("handoff mode with a malformed or empty fragment does not scrub or consume", async () => {
    const store = makeStore({ isHandoffMode: true });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute("#access_token="), // empty value
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.finishHandoff).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });

  it("handoff mode with a non-JWT fragment value is rejected (garbage token)", async () => {
    const store = makeStore({ isHandoffMode: true });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute("#access_token=not-a-jwt"), // no dots -> not JWT-shaped
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.finishHandoff).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });

  it("handoff mode with a JWT-shaped but non-strict token is rejected and never persisted", async () => {
    // Three dot-separated segments but NOT strict base64url (space in a
    // segment) — must not scrub, consume, or reach any store write.
    const store = makeStore({ isHandoffMode: true, token: null });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute("#access_token=aaa.bbb.c cc"),
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.finishHandoff).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });

  it("non-handoff mode never reads the fragment token (production behavior preserved)", async () => {
    const store = makeStore({ isHandoffMode: false });
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const router = { replace: vi.fn(), push: vi.fn() };
    const w = mount(LoginView, {
      global: {
        mocks: {
          $route: makeRoute(`#access_token=${GOOD_TOKEN}`),
          $router: router,
        },
      },
    });
    await flushPromises();
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.finishHandoff).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith("/");
    replaceState.mockRestore();
    w.unmount();
  });
});
