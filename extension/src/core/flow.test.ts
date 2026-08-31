import { describe, it, expect } from "vitest";
import {
  initialState,
  advance,
  attachTab,
  normalizeState,
  pollStatus,
  isPhaseSatisfied,
  isSsoLoggedInUrl,
  decideHandoffRequest,
  handoffSyncResponse,
  type FlowState,
  type FlowDeps,
} from "./flow.js";

const LOGIN = { sso: "SSO_URL", kulon: "KULON_URL", siap: "SIAP_URL" };
const D: FlowDeps = {
  flags: { hasSso: false, hasKulon: false, hasSiap: false },
  now: () => 1_000_000,
  MAX_RELOGIN: 2,
  PHASE_TIMEOUT_MS: 1000,
  SSO_GUARD_MS: 1500,
  loginUrl: (s) => LOGIN[s],
};

function st(mode: "auto" | "semi" = "auto"): FlowState {
  return initialState(mode);
}

function auth(
  svc: FlowState["service"],
  mode: "auto" | "semi" = "auto",
  tabId = 7,
): FlowState {
  return { ...st(mode), core: "authing", service: svc, tabId };
}

/** COOKIE_SET carries the name(s) of cookies that actually changed. */
const COOKIE_SET = (changed: string[] | undefined = ["ci_session_sso"]) => ({
  type: "COOKIE_SET" as const,
  changed,
});

describe("REQUEST", () => {
  it("starts authing:sso with no kulon cookie", () => {
    const r = advance(
      st(),
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual(
      expect.arrayContaining([{ kind: "openTab", url: "SSO_URL" }]),
    );
  });
  it("goes to handoff when kulon cookie present (verify before deciding)", () => {
    const r = advance(
      st(),
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
    );
    expect(r.state.core).toBe("handoff");
    expect(r.state.deadline).toBe(D.now() + D.PHASE_TIMEOUT_MS);
    expect(r.effects).toContainEqual({ kind: "postHandoff" });
  });
  it('resets from a terminal core:"error" state (stale persisted login failure)', () => {
    // Reproduces the stuck-state bug: a previous failed flow left core:'error'
    // in storage.local; the next REQUEST must start a fresh flow anyway.
    const stale = {
      ...st(),
      core: "error",
      service: "kulon",
      tabId: null,
    } as FlowState;
    const r = advance(
      stale,
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
    expect(r.state.reloginCount).toBe(0);
    expect(r.effects).toEqual(
      expect.arrayContaining([{ kind: "openTab", url: "SSO_URL" }]),
    );
  });
  it('resets from a terminal core:"done" state too', () => {
    const stale = {
      ...st(),
      core: "done",
      service: "siap",
      tabId: 7,
    } as FlowState;
    const r = advance(
      stale,
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
  });
  it("is a no-op while a flow is already active (no second tab)", () => {
    const r = advance(auth("sso"), { type: "REQUEST", mode: "auto" }, D);
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("preserves appTabId when resetting from a terminal state", () => {
    const stale = {
      ...st(),
      core: "error",
      service: "kulon",
      tabId: null,
      appTabId: 42,
    } as FlowState;
    const r = advance(
      stale,
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.appTabId).toBe(42);
  });
  it("always starts at SSO (does NOT skip straight to Kulon on ambient hasSso)", () => {
    // Regression: a stale/guest `ci_session_sso` cookie (hasSso true) must NOT
    // skip SSO and open Kulon's OIDC — it used to jump users to Microsoft.
    const r = advance(
      st(),
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
    expect(r.effects).toContainEqual({ kind: "openTab", url: "SSO_URL" });
    expect(r.effects).not.toContainEqual({ kind: "openTab", url: "KULON_URL" });
    // must NOT clear the (still-valid) SSO session cookie
    expect(r.effects).not.toContainEqual({
      kind: "clearCookies",
      service: "sso",
    });
  });
  it("also starts at SSO when only SIAP is missing (no SSO skip)", () => {
    const r = advance(
      st(),
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: true } },
    );
    expect(r.state.service).toBe("sso");
    expect(r.effects).toContainEqual({ kind: "openTab", url: "SSO_URL" });
  });
  it("opens the SSO login tab when SSO is NOT logged in, WITHOUT clearing the cookie", () => {
    const r = advance(
      st(),
      { type: "REQUEST", mode: "auto" },
      { ...D, flags: { hasSso: false, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("sso");
    expect(r.effects).toContainEqual({ kind: "openTab", url: "SSO_URL" });
    expect(r.effects).not.toContainEqual({
      kind: "clearCookies",
      service: "sso",
    });
  });
  it("stale-presence skip: kulon phase does NOT advance on a non-MoodleSession cookie, then TIMEOUT errors (bounded)", () => {
    const r = advance(
      {
        core: "authing",
        service: "kulon",
        settledAt: 1_000_000 - 5000,
        recentSessionChange: false,
      } as FlowState,
      COOKIE_SET(["cookiesession1"]),
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.service).toBe("kulon");
    expect(r.effects).toEqual([]);
    const timedOut = advance(r.state as FlowState, { type: "TIMEOUT" }, D);
    expect(timedOut.state.core).toBe("error");
  });
});

describe("COOKIE_SET cascade (mode auto)", () => {
  it("sso → navigate kulon when the SSO session cookie actually changed", () => {
    const settled = {
      ...auth("sso"),
      settledAt: 1_000_000 - 5000,
    } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("kulon");
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "KULON_URL" });
  });
  it("sso does NOT advance on a mere csrf/transient cookie change", () => {
    const r = advance(auth("sso"), COOKIE_SET(["csrf_cookie_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("sso ignores a real cookie event before the page has settled", () => {
    const s = { ...auth("sso"), settledAt: 0 } as FlowState;
    const r = advance(s, COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("kulon with siap → handoff", () => {
    const settled = {
      ...auth("kulon"),
      settledAt: 1_000_000 - 5000,
    } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(["MoodleSession"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.core).toBe("handoff");
  });
  it("kulon with siap ignores an LB/transient cookie change", () => {
    const r = advance(auth("kulon"), COOKIE_SET(["cookiesession1"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.core).toBe("authing");
    expect(r.effects).toEqual([]);
  });
  it("kulon without siap → navigate siap", () => {
    const settled = {
      ...auth("kulon"),
      settledAt: 1_000_000 - 5000,
    } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(["MoodleSession"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: false },
    });
    expect(r.state.service).toBe("siap");
  });
  it("siap → handoff when a SIAP session cookie changed", () => {
    const settled = {
      ...auth("siap"),
      settledAt: 1_000_000 - 5000,
    } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(["sia_app_session"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.core).toBe("handoff");
  });
  it("siap ignores a non-session cookie change", () => {
    const r = advance(auth("siap"), COOKIE_SET(["cookiesession1"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.core).toBe("authing");
  });
  it("remembers a real session-cookie change that arrives BEFORE settle so TAB_LOADED fast-paths instead of waiting for the poll", () => {
    // Kulon auto-auth sets MoodleSession early in page load, before the tab
    // reports `complete`. The COOKIE_SET below must set recentSessionChange
    // (not drop) so the subsequent TAB_LOADED advances without the 30s POLL.
    const pre = advance(auth("kulon"), COOKIE_SET(["MoodleSession"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(pre.state.recentSessionChange).toBe(true);
    expect(pre.state.core).toBe("authing");
    expect(pre.effects).toEqual([]);
    const r = advance(
      pre.state as FlowState,
      { type: "TAB_LOADED" },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
    );
    expect(r.state.core).toBe("handoff"); // advanced immediately, no poll
  });
  it("drops a pre-settle transient/LB change (does not fast-path prematurely)", () => {
    const r = advance(auth("kulon"), COOKIE_SET(["cookiesession1"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.recentSessionChange).toBe(false);
    expect(r.state.core).toBe("authing");
    expect(r.effects).toEqual([]);
  });
  it("a navigation hop resets settledAt to 0 (re-arms transient suppression)", () => {
    const settledSso = {
      ...auth("sso"),
      settledAt: 1_000_000 - 5000,
      recentSessionChange: true,
    } as FlowState;
    const r = advance(settledSso, COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("kulon");
    expect(r.state.settledAt).toBe(0);
    expect(r.state.recentSessionChange).toBe(false);
  });
  describe("TAB_LOADED (load-gated fast path)", () => {
    it("TAB_LOADED advances kulon→handoff when hasKulon && hasSiap", () => {
      const r = advance(
        { ...auth("kulon"), recentSessionChange: true },
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
      );
      expect(r.state.core).toBe("handoff");
      expect(r.state.recentSessionChange).toBe(false);
      expect(r.effects).toContainEqual({ kind: "postHandoff" });
    });
    it("TAB_LOADED advances kulon→siap when hasKulon && !hasSiap", () => {
      const r = advance(
        { ...auth("kulon"), recentSessionChange: true },
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } },
      );
      expect(r.state.service).toBe("siap");
      expect(r.state.settledAt).toBe(0);
      expect(r.state.recentSessionChange).toBe(false);
      expect(r.effects).toContainEqual({
        kind: "navigateTab",
        url: "SIAP_URL",
      });
    });
    it("TAB_LOADED advances siap→handoff when hasSiap", () => {
      const r = advance(
        { ...auth("siap"), recentSessionChange: true },
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
      );
      expect(r.state.core).toBe("handoff");
      expect(r.state.recentSessionChange).toBe(false);
    });
    it("TAB_LOADED settles but does NOT advance when the target cookie is absent", () => {
      const r = advance(
        auth("kulon"),
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.service).toBe("kulon");
      expect(r.effects).toEqual([]);
    });
    it("TAB_LOADED settles but does NOT fast-path advance in semi mode", () => {
      const r = advance(
        auth("kulon", "semi"),
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
      );
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.core).toBe("authing");
      expect(r.state.service).toBe("kulon");
      expect(r.effects).toEqual([]);
    });
    it("TAB_LOADED on sso only settles (no fast path — needs human login)", () => {
      const r = advance(
        auth("sso"),
        { type: "TAB_LOADED" },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.settledAt).toBe(D.now());
      expect(r.state.service).toBe("sso");
      expect(r.effects).toEqual([]);
    });
    it("TAB_LOADED on sso advances sso→kulon when the URL is the logged-in dashboard", () => {
      const r = advance(
        auth("sso"),
        { type: "TAB_LOADED", url: "https://sso.undip.ac.id/" },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.service).toBe("kulon");
      expect(r.effects).toContainEqual({
        kind: "navigateTab",
        url: "KULON_URL",
      });
    });

    it("TAB_LOADED advances sso on /pages/dashboard (real Undip SSO dashboard URL)", () => {
      const r = advance(
        auth("sso"),
        { type: "TAB_LOADED", url: "https://sso.undip.ac.id/pages/dashboard" },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.service).toBe("kulon");
      expect(r.effects).toContainEqual({
        kind: "navigateTab",
        url: "KULON_URL",
      });
    });
    it("TAB_LOADED on sso does NOT advance on the login form URL even with hasSso", () => {
      const r = advance(
        auth("sso"),
        { type: "TAB_LOADED", url: "https://sso.undip.ac.id/auth/user/login" },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.service).toBe("sso");
      expect(r.effects).toEqual([]);
    });
    it("TAB_LOADED on sso does NOT advance when the URL is a non-SSO host (OIDC interlude)", () => {
      const r = advance(
        auth("sso"),
        {
          type: "TAB_LOADED",
          url: "https://login.microsoftonline.com/oauth2/authorize",
        },
        { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
      );
      expect(r.state.service).toBe("sso");
    });
  });
});

describe("isSsoLoggedInUrl", () => {
  it("true for the logged-in SSO dashboard", () => {
    expect(isSsoLoggedInUrl("https://sso.undip.ac.id/")).toBe(true);
    expect(isSsoLoggedInUrl("https://sso.undip.ac.id/dashboard")).toBe(true);
  });
  it("false for the login form / auth paths", () => {
    expect(isSsoLoggedInUrl("https://sso.undip.ac.id/auth/user/login")).toBe(
      false,
    );
    expect(isSsoLoggedInUrl("https://sso.undip.ac.id/auth/login")).toBe(false);
    expect(isSsoLoggedInUrl("https://sso.undip.ac.id/sso/auth_v2")).toBe(false);
  });
  it("false for a non-SSO host (e.g. Microsoft OIDC) and for empty/undefined", () => {
    expect(
      isSsoLoggedInUrl("https://login.microsoftonline.com/oauth2/authorize"),
    ).toBe(false);
    expect(isSsoLoggedInUrl("https://kulon2.undip.ac.id/auth/oidc/")).toBe(
      false,
    );
    expect(isSsoLoggedInUrl(undefined)).toBe(false);
    expect(isSsoLoggedInUrl("not a url")).toBe(false);
  });
});

describe("mode semi ignores COOKIE_SET, waits USER_DONE", () => {
  it("COOKIE_SET does not advance without USER_DONE even with a session-cookie payload", () => {
    const r = advance(auth("sso", "semi"), COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("USER_DONE advances from sso", () => {
    const r = advance(
      auth("sso", "semi"),
      { type: "USER_DONE" },
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.service).toBe("kulon");
  });
});

describe("handoff decisions", () => {
  it("HANDOFF_OK → done + sendResult ok", () => {
    const s = { ...st(), core: "handoff", tabId: 7 } as FlowState;
    const r = advance(s, { type: "HANDOFF_OK", token: "jwt" }, D);
    expect(r.state.core).toBe("done");
    expect(r.effects).toContainEqual({
      kind: "sendResult",
      payload: { status: "ok", accessToken: "jwt" },
    });
    expect(r.effects).toContainEqual({ kind: "clearTimers" });
  });
  it("HANDOFF_NEEDS_SERVICE:siap → authing:siap + clearCookies", () => {
    const s = { ...st(), core: "handoff", tabId: 7 } as FlowState;
    const r = advance(s, { type: "HANDOFF_NEEDS_SERVICE", service: "siap" }, D);
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("siap");
    expect(r.effects).toContainEqual({ kind: "clearCookies", service: "siap" });
  });
  it("HANDOFF_NEEDS_SERVICE:siap opens a tab when no login tab is tracked", () => {
    const s = { ...st(), core: "handoff", tabId: null } as FlowState;
    const r = advance(s, { type: "HANDOFF_NEEDS_SERVICE", service: "siap" }, D);
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("siap");
    expect(r.effects).toContainEqual({ kind: "openTab", url: "SIAP_URL" });
    expect(r.effects).not.toContainEqual({
      kind: "navigateTab",
      url: "SIAP_URL",
    });
  });
  it("HANDOFF_NEEDS_SERVICE:siap navigates the tracked login tab", () => {
    const s = { ...st(), core: "handoff", tabId: 7 } as FlowState;
    const r = advance(s, { type: "HANDOFF_NEEDS_SERVICE", service: "siap" }, D);
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "SIAP_URL" });
    expect(r.effects).not.toContainEqual({ kind: "openTab", url: "SIAP_URL" });
  });
  it("HANDOFF_STALE service:sso re-auths sso in the SAME tab (no closeAllTabs; clear downstream + upstream)", () => {
    const s = {
      ...st(),
      core: "handoff",
      tabId: 7,
      reloginCount: 0,
    } as FlowState;
    const r = advance(
      s,
      { type: "HANDOFF_STALE", service: "sso" },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } },
    );
    expect(r.state.service).toBe("sso");
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).not.toContainEqual({ kind: "closeAllTabs" });
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "SSO_URL" });
    // service:sso clears the full chain (sso+kulon+siap).
    expect(r.effects).toContainEqual({ kind: "clearCookies", service: "sso" });
    expect(r.effects).toContainEqual({
      kind: "clearCookies",
      service: "kulon",
    });
    expect(r.effects).toContainEqual({ kind: "clearCookies", service: "siap" });
  });
  it("HANDOFF_STALE service:sso without live SSO → re-auth sso in the same tab", () => {
    const r = advance(
      { ...st(), core: "handoff", tabId: 7, reloginCount: 0 } as FlowState,
      { type: "HANDOFF_STALE", service: "sso" },
      D,
    );
    expect(r.state.service).toBe("sso");
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "SSO_URL" });
  });
  it("HANDOFF_STALE service:sso without any tab yet → opens a new tab", () => {
    const r = advance(
      { ...st(), core: "handoff", tabId: null, reloginCount: 0 } as FlowState,
      { type: "HANDOFF_STALE", service: "sso" },
      D,
    );
    expect(r.effects).toContainEqual({ kind: "openTab", url: "SSO_URL" });
  });
  it("HANDOFF_STALE at MAX_RELOGIN → error", () => {
    const s = {
      ...st(),
      core: "handoff",
      tabId: 7,
      reloginCount: 2,
    } as FlowState;
    const r = advance(s, { type: "HANDOFF_STALE", service: "sso" }, D);
    expect(r.state.core).toBe("error");
  });
  it("HANDOFF_STALE service:kulon re-auths Kulon (keeps SSO cookie), in SAME tab", () => {
    const s = {
      ...st(),
      core: "handoff",
      tabId: 7,
      reloginCount: 0,
    } as FlowState;
    const r = advance(
      s,
      { type: "HANDOFF_STALE", service: "kulon" },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } },
    );
    expect(r.state.core).toBe("authing");
    expect(r.state.service).toBe("kulon");
    expect(r.state.reloginCount).toBe(1);
    expect(r.effects).not.toContainEqual({ kind: "closeAllTabs" });
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "KULON_URL" });
    // clearDownstream = kulon + siap; SSO dipertahankan (TIDAK di-clear).
    expect(r.effects).toContainEqual({
      kind: "clearCookies",
      service: "kulon",
    });
    expect(r.effects).toContainEqual({ kind: "clearCookies", service: "siap" });
    expect(r.effects).not.toContainEqual({
      kind: "clearCookies",
      service: "sso",
    });
  });
  it("HANDOFF_STALE service:kulon without a tab yet → opens a new Kulon tab", () => {
    const r = advance(
      { ...st(), core: "handoff", tabId: null, reloginCount: 0 } as FlowState,
      { type: "HANDOFF_STALE", service: "kulon" },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: false } },
    );
    expect(r.state.service).toBe("kulon");
    expect(r.effects).toContainEqual({ kind: "openTab", url: "KULON_URL" });
    expect(r.effects).not.toContainEqual({
      kind: "clearCookies",
      service: "sso",
    });
  });
});

describe("TIMEOUT / CLOSE_ALL", () => {
  it("TIMEOUT → error", () => {
    const r = advance(auth("sso"), { type: "TIMEOUT" }, D);
    expect(r.state.core).toBe("error");
    expect(r.effects).toContainEqual({ kind: "clearTimers" });
  });
  it("CLOSE_ALL → idle", () => {
    const r = advance(
      { ...st(), core: "handoff", tabId: 7 } as FlowState,
      { type: "CLOSE_ALL" },
      D,
    );
    expect(r.state.core).toBe("idle");
    expect(r.effects).toContainEqual({ kind: "closeAllTabs" });
  });
});

describe("attachTab", () => {
  it("adds tab id and tracks it in tabs[]", () => {
    const s = attachTab({ ...st(), core: "authing", service: "sso" }, 9);
    expect(s.tabId).toBe(9);
    expect(s.tabs).toContain(9);
  });
  it("does not duplicate an existing tab id", () => {
    const base = attachTab({ ...st(), core: "authing", service: "sso" }, 9);
    const again = attachTab(base, 9);
    expect(again.tabs).toEqual([9]);
  });
});

describe("normalizeState (zombie-flow recovery)", () => {
  const NOW = 2_000_000;
  it("keeps an idle state as-is", () => {
    expect(normalizeState(st(), NOW)).toEqual(st());
  });
  it("resets terminal done/error without a tab to idle", () => {
    expect(
      normalizeState(
        { ...st(), core: "error", service: "kulon", tabId: null } as FlowState,
        NOW,
      ).core,
    ).toBe("idle");
    expect(
      normalizeState(
        { ...st(), core: "done", service: "siap", tabId: null } as FlowState,
        NOW,
      ).core,
    ).toBe("idle");
  });
  it("keeps terminal state when a tab is still tracked (flow may be finishing)", () => {
    expect(
      normalizeState(
        { ...st(), core: "done", service: "siap", tabId: 7 } as FlowState,
        NOW,
      ).core,
    ).toBe("done");
  });
  it("resets a zombie authing flow whose deadline already passed (SW killed / extension reloaded)", () => {
    const zombie = {
      ...st(),
      core: "authing",
      service: "sso",
      tabId: 7,
      deadline: NOW - 1,
    } as FlowState;
    const r = normalizeState(zombie, NOW);
    expect(r.core).toBe("idle");
    expect(r.tabId).toBeNull();
  });
  it("resets a zombie handoff flow whose deadline already passed", () => {
    const zombie = {
      ...st(),
      core: "handoff",
      service: null,
      tabId: 7,
      deadline: NOW - 1,
    } as FlowState;
    expect(normalizeState(zombie, NOW).core).toBe("idle");
  });
  it("keeps an ACTIVE authing flow whose deadline is still in the future", () => {
    const live = {
      ...st(),
      core: "authing",
      service: "sso",
      tabId: 7,
      deadline: NOW + 1000,
    } as FlowState;
    expect(normalizeState(live, NOW).core).toBe("authing");
  });
  it("defaults settledAt to 0 for a persisted state written before settledAt existed", () => {
    const legacy = {
      ...st(),
      core: "authing",
      service: "sso",
      tabId: 7,
      deadline: NOW + 1000,
    } as unknown as FlowState;
    delete (legacy as unknown as Record<string, unknown>).settledAt; // simulate old persisted shape
    const r = normalizeState(legacy, NOW);
    expect(r.settledAt).toBe(0);
  });
  it("defaults recentSessionChange to false and preserves same reference for a live state", () => {
    const legacy = {
      ...st(),
      core: "authing",
      service: "sso",
      tabId: 7,
      deadline: NOW + 1000,
    } as unknown as FlowState;
    delete (legacy as unknown as Record<string, unknown>).settledAt; // simulate old persisted shape
    expect(normalizeState(legacy, NOW).recentSessionChange).toBe(false);
    // A live state with settledAt: 0 and recentSessionChange: false is returned as the same reference.
    const live = {
      ...st(),
      core: "authing",
      service: "sso",
      tabId: 7,
      deadline: NOW + 1000,
      settledAt: 0,
      recentSessionChange: false,
    } as FlowState;
    expect(normalizeState(live, NOW)).toBe(live);
  });
});

describe("load-gated COOKIE_SET + SSO guard", () => {
  it("real COOKIE_SET is ignored before the page settles (kulon)", () => {
    const r = advance(auth("kulon"), COOKIE_SET(["MoodleSession"]), {
      ...D,
      flags: { hasSso: true, hasKulon: true, hasSiap: true },
    });
    expect(r.state.core).toBe("authing");
    expect(r.effects).toEqual([]);
  });
  it("real COOKIE_SET is accepted after the page settles (sso → kulon)", () => {
    const settled = {
      ...auth("sso"),
      settledAt: 1_000_000 - 5000,
    } as FlowState; // settled long ago
    const r = advance(settled, COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("kulon");
    expect(r.effects).toContainEqual({ kind: "navigateTab", url: "KULON_URL" });
  });
  it("sso skips a guest ci_session_sso within the post-settle guard", () => {
    const s = { ...auth("sso"), settledAt: 1_000_000 - 500 } as FlowState; // settled 500ms ago (< SSO_GUARD_MS)
    const r = advance(s, COOKIE_SET(["ci_session_sso"]), {
      ...D,
      flags: { hasSso: true, hasKulon: false, hasSiap: false },
    });
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("true poll forces settle on sso (bounded fallback) but does NOT advance", () => {
    const r = advance(
      auth("sso"),
      { type: "COOKIE_SET", changed: undefined },
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.settledAt).toBe(1_000_000);
    expect(r.state.service).toBe("sso");
    expect(r.effects).toEqual([]);
  });
  it("true poll advances kulon when hasKulon even if not settled", () => {
    const r = advance(
      auth("kulon"),
      { type: "COOKIE_SET", changed: undefined },
      { ...D, flags: { hasSso: true, hasKulon: true, hasSiap: true } },
    );
    expect(r.state.core).toBe("handoff");
  });
  it("USER_DONE (semi) advances even when not settled", () => {
    const r = advance(
      auth("sso", "semi"),
      { type: "USER_DONE" },
      { ...D, flags: { hasSso: true, hasKulon: false, hasSiap: false } },
    );
    expect(r.state.service).toBe("kulon");
  });
});

describe("pollStatus (SPA status poll — self-healing)", () => {
  it("returns cached result as-is when present", () => {
    const cached = { status: "ok" as const, accessToken: "jwt" };
    expect(pollStatus(cached, { core: "idle", service: null })).toBe(cached);
  });
  it("reports in-progress when no cached result but flow is active", () => {
    const r = pollStatus(undefined, { core: "authing", service: "sso" });
    expect(r).toEqual({ status: "ok", active: true, phase: "sso" });
  });
  it("returns ERROR (terminal) when no cached result and flow is inactive", () => {
    // This is the fix: a dead/idle flow with no recoverable result must settle
    // the SPA poll (which only settles on ok+token or error), NOT hang forever.
    const r = pollStatus(undefined, { core: "idle", service: null });
    expect(r.status).toBe("error");
  });
  it("treats done/error state with no cached result as inactive → error", () => {
    const r = pollStatus(undefined, { core: "done", service: "siap" });
    expect(r.status).toBe("error");
  });
});

describe("isPhaseSatisfied (recover a flow wedged in an already-satisfied phase)", () => {
  it("is false when the flow is not authing at all", () => {
    expect(
      isPhaseSatisfied(
        { core: "done", service: "sso" },
        { hasSso: true, hasKulon: false, hasSiap: false },
      ),
    ).toBe(false);
  });
  it("flags authing:sso with an existing SSO session cookie as recoverable", () => {
    // Reproduces the stuck bug: the flow is in the SSO phase but the user is
    // ALREADY logged into SSO (hasSso). It only advances on a ci_session_sso
    // cookie CHANGE, which an established session never emits — so it stays
    // stuck forever and the handoff handler must reset it and re-request.
    expect(
      isPhaseSatisfied(
        { core: "authing", service: "sso" },
        { hasSso: true, hasKulon: false, hasSiap: false },
      ),
    ).toBe(true);
  });
  it("is false for authing:sso when SSO is NOT logged in (genuine login in progress)", () => {
    expect(
      isPhaseSatisfied(
        { core: "authing", service: "sso" },
        { hasSso: false, hasKulon: false, hasSiap: false },
      ),
    ).toBe(false);
  });
  it("flags authing:kulon when a Kulon session cookie already exists", () => {
    expect(
      isPhaseSatisfied(
        { core: "authing", service: "kulon" },
        { hasSso: true, hasKulon: true, hasSiap: false },
      ),
    ).toBe(true);
  });
  it("flags authing:siap when a SIAP session cookie already exists", () => {
    expect(
      isPhaseSatisfied(
        { core: "authing", service: "siap" },
        { hasSso: true, hasKulon: true, hasSiap: true },
      ),
    ).toBe(true);
  });
  it("is false when the active phase has NO corresponding cookie yet", () => {
    expect(
      isPhaseSatisfied(
        { core: "authing", service: "kulon" },
        { hasSso: true, hasKulon: false, hasSiap: false },
      ),
    ).toBe(false);
  });
  it("treats a null service as not recoverable", () => {
    expect(
      isPhaseSatisfied(
        { core: "authing", service: null },
        { hasSso: true, hasKulon: false, hasSiap: false },
      ),
    ).toBe(false);
  });
});

describe("LOGOUT (reset the flow so the next login starts fresh)", () => {
  it("resets an active authing flow to idle and closes login tabs", () => {
    const r = advance(auth("sso"), { type: "LOGOUT" }, D);
    expect(r.state.core).toBe("idle");
    expect(r.state.service).toBeNull();
    expect(r.state.tabId).toBeNull();
    expect(r.state.tabs).toEqual([]);
    expect(r.effects).toContainEqual({ kind: "clearTimers" });
    expect(r.effects).toContainEqual({ kind: "closeAllTabs" });
  });
  it("resets a terminal done flow too (clears stale result state)", () => {
    const done = {
      ...st(),
      core: "done",
      service: "siap",
      tabId: 9,
      tabs: [9],
    } as FlowState;
    const r = advance(done, { type: "LOGOUT" }, D);
    expect(r.state.core).toBe("idle");
    expect(r.state.service).toBeNull();
    expect(r.effects).toContainEqual({ kind: "closeAllTabs" });
  });
  it("is an idempotent no-change reset from idle", () => {
    const r = advance(st(), { type: "LOGOUT" }, D);
    expect(r.state).toEqual(st());
    // still emits cleanup effects so the adapter clears timers/results
    expect(r.effects).toContainEqual({ kind: "clearTimers" });
  });
});


/**
 * The external "handoff" message used to make these decisions inline in
 * background.ts — the one file with no tests. They now live in core so the
 * adapter only reads chrome.* inputs and executes effects.
 */
describe("decideHandoffRequest", () => {
  it("idle flow -> request a fresh run", () => {
    expect(decideHandoffRequest({ state: st(), tabAlive: false, phaseSatisfied: false })).toEqual({
      kind: "request",
    });
  });

  it("terminal state is not active -> request a fresh run", () => {
    for (const core of ["done", "error"] as const) {
      const state = { ...st(), core };
      expect(
        decideHandoffRequest({ state, tabAlive: true, phaseSatisfied: true }),
      ).toEqual({ kind: "request" });
    }
  });

  it("zombie recovery: active flow whose login tab is gone -> reset", () => {
    const decision = decideHandoffRequest({
      state: auth("sso"),
      tabAlive: false,
      phaseSatisfied: false,
    });
    expect(decision).toEqual({ kind: "reset", reason: "zombie-tab" });
  });

  it("wedged-phase recovery: active flow waiting on an already-satisfied phase -> reset", () => {
    // SSO cookie already present while the flow waits on the sso phase.
    const decision = decideHandoffRequest({
      state: auth("sso"),
      tabAlive: true,
      phaseSatisfied: true,
    });
    expect(decision).toEqual({ kind: "reset", reason: "satisfied-phase" });
  });

  it("a live, unsatisfied active flow answers already-started (no new run)", () => {
    const state = auth("kulon", "semi");
    expect(
      decideHandoffRequest({ state, tabAlive: true, phaseSatisfied: false }),
    ).toEqual({ kind: "already-started", mode: "semi" });
  });
});

describe("handoffSyncResponse", () => {
  it("done within this pass -> replay the cached REAL token", () => {
    const cached = { status: "ok" as const, accessToken: "JWT" };
    expect(handoffSyncResponse({ core: "done", mode: "auto" }, cached)).toEqual({
      status: "ok",
      accessToken: "JWT",
    });
  });

  it("done without a usable cached token -> explicit error, never a placeholder", () => {
    expect(
      handoffSyncResponse({ core: "done", mode: "auto" }, undefined),
    ).toEqual({ status: "error", message: "Sesi login selesai tanpa token. Coba lagi." });
    expect(
      handoffSyncResponse(
        { core: "done", mode: "auto" },
        { status: "started", mode: "auto" },
      ),
    ).toEqual({ status: "error", message: "Sesi login selesai tanpa token. Coba lagi." });
  });

  it("error within this pass -> prefer the cached error message", () => {
    const cached = { status: "error" as const, message: "KULON_STALE" };
    expect(handoffSyncResponse({ core: "error", mode: "auto" }, cached)).toEqual({
      status: "error",
      message: "KULON_STALE",
    });
    expect(handoffSyncResponse({ core: "error", mode: "auto" }, undefined)).toEqual({
      status: "error",
      message: "Sesi layanan gagal diperbarui. Silakan coba lagi.",
    });
  });

  it("still running -> started with the flow's mode", () => {
    expect(handoffSyncResponse({ core: "authing", mode: "semi" }, undefined)).toEqual({
      status: "started",
      mode: "semi",
    });
  });
});
