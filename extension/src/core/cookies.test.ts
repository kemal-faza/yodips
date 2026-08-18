import { describe, it, expect } from "vitest";
import {
  evaluateCookies,
  cookiesToStr,
  buildHandoffBody,
  cookiePatternsForPhase,
  phasesToClear,
  cookieStoreForTab,
  SSO_SESSION_COOKIE,
} from "./cookies.js";

// Two stores: regular (no special marker) + an incognito store that owns the
// login tab. Mimics the real browser where an incognito window uses its own
// separate cookie store.
const REGULAR: { id: string; tabIds: number[] } = { id: "0", tabIds: [1, 2] };
const INCOGNITO: { id: string; tabIds: number[] } = {
  id: "incognito-net",
  tabIds: [3, 4],
};

const KULON = {
  name: "MoodleSession",
  domain: "kulon2.undip.ac.id",
  value: "abc",
};
const SSO_CSRF = {
  name: "csrftoken",
  domain: "sso.undip.ac.id",
  value: "sso1",
};
const SSO_SESS = {
  name: "ci_session_sso",
  domain: "sso.undip.ac.id",
  value: "ssoX",
};
const SIAP = {
  name: "sia_app_session",
  domain: "siap.undip.ac.id",
  value: "siap1",
};
const MS = { name: "MSAuth", domain: "login.live.com", value: "ms1" };

describe("evaluateCookies", () => {
  it("keys SSO on the real session cookie, not mere csrftoken", () => {
    expect(evaluateCookies([KULON, SSO_CSRF, SIAP])).toEqual({
      hasSso: false,
      hasKulon: true,
      hasSiap: true,
    });
    expect(evaluateCookies([SSO_SESS, KULON, SIAP]).hasSso).toBe(true);
  });
  it("keys Kulon on a MoodleSession cookie name", () => {
    expect(evaluateCookies([SSO_SESS, SIAP]).hasKulon).toBe(false);
    expect(evaluateCookies([SSO_SESS, KULON, SIAP]).hasKulon).toBe(true);
  });
  it("ignores a load-balancer cookie on the siap domain as evidence of a SIAP session", () => {
    const LB = {
      name: "cookiesession1",
      domain: "siap.undip.ac.id",
      value: "x",
    };
    expect(evaluateCookies([LB]).hasSiap).toBe(false);
  });
  it("keys SIAP on a session-named cookie (sia_/sipp/ciapp_) on siap or parent domain", () => {
    expect(
      evaluateCookies([
        { name: "sia_app_session", domain: "siap.undip.ac.id", value: "y" },
      ]).hasSiap,
    ).toBe(true);
    expect(
      evaluateCookies([
        { name: "sipp_session", domain: "undip.ac.id", value: "z" },
      ]).hasSiap,
    ).toBe(true);
    expect(
      evaluateCookies([
        { name: "csrftoken", domain: "siap.undip.ac.id", value: "w" },
      ]).hasSiap,
    ).toBe(false);
  });
});

describe("cookieStoreForTab", () => {
  it("picks the incognito store when the login tab lives in the incognito store", () => {
    expect(cookieStoreForTab([REGULAR, INCOGNITO], 3)).toBe("incognito-net");
    expect(cookieStoreForTab([REGULAR, INCOGNITO], 4)).toBe("incognito-net");
  });
  it("picks the regular store for a regular-window login tab", () => {
    expect(cookieStoreForTab([REGULAR, INCOGNITO], 1)).toBe("0");
    expect(cookieStoreForTab([REGULAR, INCOGNITO], 2)).toBe("0");
  });
  it("falls back to the default (empty-tabIds) store when the tab owns no store", () => {
    const defaultStore = { id: "0", tabIds: [] };
    expect(cookieStoreForTab([defaultStore, INCOGNITO], null)).toBe("0");
    expect(cookieStoreForTab([defaultStore, INCOGNITO], 999)).toBe("0");
  });
  it("returns undefined for an empty store list", () => {
    expect(cookieStoreForTab([], null)).toBeUndefined();
  });
});

describe("cookiesToStr", () => {
  it("groups matching cookies into a string", () => {
    expect(
      cookiesToStr([KULON, SSO_SESS], (c) => c.domain.includes("undip.ac.id")),
    ).toBe("MoodleSession=abc; ci_session_sso=ssoX");
  });
});

describe("buildHandoffBody", () => {
  it("segments cookies per service", () => {
    const body = buildHandoffBody([KULON, SSO_SESS, MS, SIAP]);
    expect(body.kulonCookie).toContain("MoodleSession=abc");
    expect(body.ssoCookie).toContain("ci_session_sso=ssoX");
    expect(body.microsoftCookie).toContain("MSAuth=ms1");
    expect(body.siapCookie).toContain("sia_app_session=siap1");
  });
  it("excludes a bare csrftoken from ssoCookie on the parent domain", () => {
    const parentCsrf = { name: "csrftoken", domain: "undip.ac.id", value: "x" };
    const parentSso = {
      name: "ci_session_sso",
      domain: "undip.ac.id",
      value: "y",
    };
    expect(buildHandoffBody([parentCsrf]).ssoCookie).toBe("");
    expect(buildHandoffBody([parentSso]).ssoCookie).toContain(
      "ci_session_sso=y",
    );
  });
});

describe("clear patterns", () => {
  it("clears kazakh SSO session cookie name only", () => {
    const pats = cookiePatternsForPhase("sso");
    expect(pats.some((p) => p.name === SSO_SESSION_COOKIE)).toBe(true);
  });
  it("phasesToClear returns phase and downstream", () => {
    expect(phasesToClear("sso")).toEqual(["sso", "kulon", "siap"]);
    expect(phasesToClear("kulon")).toEqual(["kulon", "siap"]);
    expect(phasesToClear("siap")).toEqual(["siap"]);
  });
});
