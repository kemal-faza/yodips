import type {
  CookieFlags,
  FlowMode,
  OutboundStatus,
  Service,
} from "./contract.js";
import {
  phasesToClear,
  SSO_SESSION_COOKIE,
  SIAP_SESSION_COOKIE_RE,
} from "./cookies.js";

export interface FlowState {
  core: "idle" | "authing" | "handoff" | "done" | "error";
  service: Service | null;
  tabId: number | null;
  tabs: number[];
  appTabId: number | null;
  deadline: number;
  reloginCount: number;
  mode: FlowMode;
  /** Timestamp (ms) when the login tab finished loading (TAB_LOADED), or 0 if
   *  not yet settled. While 0, real COOKIE_SET events are ignored — the landing
   *  page's transient cookies (F5 `cookiesession1`, CSRF, guest sessions) are not
   *  evidence of a completed login. The poll safety net forces settle as a
   *  bounded fallback for the SSO phase. */
  settledAt: number;
  /** True when a real session-cookie change was accepted since the last settle.
   *  The TAB_LOADED fast-path only advances when this is set — the mere presence
   *  of cookies (which fleeting landing-page cookies also satisfy) is not enough. */
  recentSessionChange: boolean;
}

export type FlowEvent =
  | { type: "REQUEST"; mode: FlowMode }
  | { type: "COOKIE_SET"; changed?: string[] }
  | { type: "TAB_LOADED"; url?: string }
  | { type: "HANDOFF_OK"; token: string }
  | { type: "HANDOFF_NEEDS_SERVICE"; service: Service }
  | { type: "HANDOFF_STALE"; service: Service }
  | { type: "HANDOFF_ERROR"; message: string }
  | { type: "TIMEOUT" }
  | { type: "USER_DONE" }
  | { type: "CLOSE_ALL" }
  | { type: "LOGOUT" };

export interface FlowDeps {
  flags: CookieFlags;
  now: () => number;
  MAX_RELOGIN: number;
  PHASE_TIMEOUT_MS: number;
  /** Post-load guard for the SSO page: skip the guest `ci_session_sso` dropped
   *  right after settle (~1.5s). Automatic hops (Kulon/SIAP) have no guard. */
  SSO_GUARD_MS: number;
  loginUrl: (s: Service) => string;
}

export type FlowEffect =
  | { kind: "openTab"; url: string }
  | { kind: "navigateTab"; url: string }
  | { kind: "closeAllTabs" }
  | { kind: "clearCookies"; service: Service }
  | { kind: "postHandoff" }
  | { kind: "sendResult"; payload: OutboundStatus }
  | { kind: "scheduleTimers"; deadline: number }
  | { kind: "clearTimers" }
  | { kind: "focusAppTab" };

export function initialState(mode: FlowMode = "auto"): FlowState {
  return {
    core: "idle",
    service: null,
    tabId: null,
    tabs: [],
    appTabId: null,
    deadline: 0,
    reloginCount: 0,
    mode,
    settledAt: 0,
    recentSessionChange: false,
  };
}

/**
 * POSITIVE login signal for the SSO phase, decoded from the login tab's URL
 * when it finishes loading. A logged-in SSO session lands on the dashboard /
 * a non-login path; the login FORM is `/auth/user/login` (or `/sso/auth`).
 * We can NOT rely on the `ci_session_sso` cookie CHANGING — an
 * already-established session never emits a set event, and a guest session
 * carries the cookie BEFORE login. The loaded URL cleanly separates the two,
 * and a Microsoft OIDC hop (different host) is excluded.
 */
export function isSsoLoggedInUrl(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname !== "sso.undip.ac.id") return false;
  return !/^\/(auth\/user\/login|auth\/login|sso\/auth)/.test(u.pathname);
}

export function attachTab(state: FlowState, tabId: number): FlowState {
  return {
    ...state,
    tabId,
    tabs: state.tabs.includes(tabId) ? state.tabs : [...state.tabs, tabId],
  };
}

/**
 * Recover a persisted flow state that is no longer real before treating it as
 * live:
 *  - terminal `done`/`error` WITHOUT a live login tab → reset to idle (the next
 *    REQUEST must start fresh; a stale core:'error' must not block a login).
 *  - `authing`/`handoff` whose phase deadline already passed → zombie: a
 *    killed service worker or an extension reload left the flow half-alive
 *    (chrome.alarms do NOT survive a reload, so TIMEOUT never fired). Reset to
 *    idle too, otherwise `active` stays true forever and no tab ever opens.
 * Any other state (live flow, terminal with a still-relevant tab) is kept.
 */
export function normalizeState(state: FlowState, now: number): FlowState {
  // Migrate a persisted state written before `settledAt`/`recentSessionChange`
  // existed: default `settledAt` to 0 (not yet settled) and the change flag to
  // false, so the load-gate suppresses transient cookies correctly.
  const settled =
    typeof state.settledAt === "number" && state.settledAt >= 0
      ? state.settledAt
      : 0;
  const changed = state.recentSessionChange === true;
  const normalized =
    settled === state.settledAt && changed === state.recentSessionChange
      ? state
      : { ...state, settledAt: settled, recentSessionChange: changed };
  if (state.core === "done" || state.core === "error") {
    if (state.tabId == null) return initialState(state.mode);
    return normalized;
  }
  if (
    (state.core === "authing" || state.core === "handoff") &&
    now > state.deadline
  ) {
    return initialState(state.mode);
  }
  return normalized;
}

export function redact(state: FlowState): {
  core: string;
  phase: string | null;
  tabId: number | null;
} {
  return { core: state.core, phase: state.service, tabId: state.tabId };
}

/**
 * True when a currently-running flow is wedged in a phase the live cookies
 * already satisfy. An `authing` flow only advances on a session-cookie CHANGE
 * (see `sessionCookieChanged`), which an already-established session never
 * emits — so a flow stuck waiting on a satisfied phase can never get out on its
 * own. The handoff handler resets such a flow and re-runs REQUEST to fast-path
 * past the satisfied phase, instead of answering "started" forever and forcing
 * the user to close the login tab manually.
 */
export function isPhaseSatisfied(
  state: Pick<FlowState, "core" | "service">,
  flags: CookieFlags,
): boolean {
  if (state.core !== "authing") return false;
  switch (state.service) {
    case "sso":
      return flags.hasSso;
    case "kulon":
      return flags.hasKulon;
    case "siap":
      return flags.hasSiap;
    default:
      return false;
  }
}

export type PollStatus =
  | OutboundStatus
  | { status: "ok"; active: boolean; phase: string | null };

/**
 * Decide the SPA's self-healing `status` poll response from the cached result
 * and current flow state. A cached result (ok/error) is returned as-is so the
 * SPA can recover or settle. Otherwise, if a flow is ACTIVE report "in
 * progress" (keep waiting); if INACTIVE with no recoverable result, return an
 * ERROR (terminal) — the SPA must NOT poll forever on a dead/intentionally-
 * stopped flow (its poll only settles on ok+token or error).
 */
export function pollStatus(
  cached: OutboundStatus | undefined,
  state: Pick<FlowState, "core" | "service">,
): PollStatus {
  if (cached) return cached;
  const active = state.core === "authing" || state.core === "handoff";
  if (active) return { status: "ok", active: true, phase: state.service };
  return {
    status: "error",
    message:
      'Sesi login belum selesai. Silakan klik "Login via Extension" lagi.',
  };
}

/** Adapter-gathered inputs for an external handoff request (chrome.* I/O). */
export interface HandoffRequestInputs {
  state: FlowState;
  /** Does the flow's login tab still exist? (user may have closed it.) */
  tabAlive: boolean;
  /**
   * Live-cookie evaluation of the running flow's current phase
   * (`isPhaseSatisfied(state, evaluateCookies(...))`). False when not active.
   */
  phaseSatisfied: boolean;
}

export type HandoffDecision =
  | { kind: "request" }
  | { kind: "reset"; reason: "zombie-tab" | "satisfied-phase" }
  | { kind: "already-started"; mode: FlowMode };

/**
 * Decide what an external "handoff" request must do about any PRE-EXISTING
 * flow before starting a new one. Three situations need policy:
 *  - Zombie recovery: an "active" flow whose login tab no longer exists (user
 *    closed it, or the SW was killed mid-flow) can never finish — its deadline
 *    hasn't passed, so getState() keeps it alive. Reset to idle so the REQUEST
 *    opens a fresh tab instead of answering "started" forever.
 *  - Wedged-phase recovery: a running flow wedged in a phase the live cookies
 *    already satisfy (e.g. waiting on SSO while already logged into SSO) only
 *    advances on a session-cookie CHANGE, which an established session never
 *    emits. Reset so the REQUEST fast-paths past the satisfied phase.
 *  - A live, unsatisfied active flow must NOT be double-started: answer
 *    "started" and leave it alone.
 */
export function decideHandoffRequest(
  inputs: HandoffRequestInputs,
): HandoffDecision {
  const { state } = inputs;
  const active = state.core === "authing" || state.core === "handoff";
  if (!active) return { kind: "request" };
  if (!inputs.tabAlive) return { kind: "reset", reason: "zombie-tab" };
  if (inputs.phaseSatisfied)
    return { kind: "reset", reason: "satisfied-phase" };
  return { kind: "already-started", mode: state.mode };
}

/**
 * Interpret the flow state AFTER a synchronous REQUEST pass and shape the
 * immediate response to the external handoff message. The sendResult effect
 * caches the real token; when the flow finished within this pass we replay
 * that cache (never a placeholder) and surface in-pass failures instead of
 * answering "started" on a tab that will never open.
 */
export function handoffSyncResponse(
  after: Pick<FlowState, "core" | "mode">,
  cached: OutboundStatus | undefined,
): OutboundStatus {
  if (after.core === "done") {
    if (cached?.status === "ok" && cached.accessToken) {
      return { status: "ok", accessToken: cached.accessToken };
    }
    return {
      status: "error",
      message: "Sesi login selesai tanpa token. Coba lagi.",
    };
  }
  if (after.core === "error") {
    const msg = cached?.status === "error" ? cached.message : undefined;
    return {
      status: "error",
      message: msg ?? "Sesi layanan gagal diperbarui. Silakan coba lagi.",
    };
  }
  return { status: "started", mode: after.mode };
}

function deadline(deps: FlowDeps): number {
  return deps.now() + deps.PHASE_TIMEOUT_MS;
}

function clearFor(service: Service): FlowEffect[] {
  return phasesToClear(service).map((s) => ({
    kind: "clearCookies" as const,
    service: s,
  }));
}

const KULON_SESSION_COOKIE_RE = /^MoodleSession/;

/**
 * A `COOKIE_SET` event may carry the names of the cookies that actually
 * changed (from `chrome.cookies.onChanged`). Advance ONLY when that set names
 * the CURRENT phase's real session cookie — transient cookies the login page
 * drops on load (F5 `cookiesession1`, CSRF, pre-auth MoodleSession, pre-auth
 * guest `ci_session_sso`) are exactly what used to trigger endless premature
 * handoffs before the user ever logged in.
 *
 * `changed` stays absent for the POLL safety net. For `sso` the poll must
 * still NOT advance: `ci_session_sso` exists even on a guest session cookie
 * (present BEFORE login), so presence proves nothing. Kulon/SIAP on the other
 * hand are only ever entered AFTER an SSO login (or a validated handoff), so
 * their flag checks are meaningful — the poll may finish them.
 */
function sessionCookieChanged(
  event: Extract<FlowEvent, { type: "COOKIE_SET" }>,
  phase: Service | null,
): boolean {
  const changed = event.changed;
  if (!changed || changed.length === 0) return phase !== "sso"; // poll: flags decide EXCEPT sso
  if (phase === "sso") return changed.includes(SSO_SESSION_COOKIE);
  if (phase === "kulon")
    return changed.some((n) => KULON_SESSION_COOKIE_RE.test(n));
  if (phase === "siap")
    return changed.some((n) => SIAP_SESSION_COOKIE_RE.test(n));
  return true;
}

/** Shared advance logic for the current authing phase, called once the gate
 *  (cookie event accepted, page settled, or USER_DONE) has passed. */
function advanceAuth(
  state: FlowState,
  deps: FlowDeps,
): { state: FlowState; effects: FlowEffect[] } {
  const { flags } = deps;
  const svc = state.service;
  if (svc === "sso") {
    if (!flags.hasSso) return { state, effects: [] };
    return {
      state: {
        ...state,
        service: "kulon",
        deadline: deadline(deps),
        settledAt: 0,
        recentSessionChange: false,
      },
      effects: [
        { kind: "navigateTab", url: deps.loginUrl("kulon") },
        { kind: "scheduleTimers", deadline: deadline(deps) },
      ],
    };
  }
  if (svc === "kulon") {
    if (!flags.hasKulon) return { state, effects: [] };
    if (!flags.hasSiap) {
      return {
        state: {
          ...state,
          service: "siap",
          deadline: deadline(deps),
          settledAt: 0,
          recentSessionChange: false,
        },
        effects: [
          { kind: "navigateTab", url: deps.loginUrl("siap") },
          { kind: "scheduleTimers", deadline: deadline(deps) },
        ],
      };
    }
    return {
      state: { ...state, core: "handoff" },
      effects: [{ kind: "postHandoff" }],
    };
  }
  // svc === 'siap'
  if (!flags.hasSiap) return { state, effects: [] };
  return {
    state: { ...state, core: "handoff" },
    effects: [{ kind: "postHandoff" }],
  };
}

export function advance(
  state: FlowState,
  event: FlowEvent,
  deps: FlowDeps,
): { state: FlowState; effects: FlowEffect[] } {
  const { flags } = deps;

  if (event.type === "CLOSE_ALL" || event.type === "LOGOUT") {
    return {
      state: initialState(state.mode),
      effects: [{ kind: "clearTimers" }, { kind: "closeAllTabs" }],
    };
  }

  // REQUEST is an explicit "start a fresh login" command: it restarts from ANY
  // terminal state (idle/done/error) — a stale persisted `core:'error'` from a
  // previous failed flow must not block the next login. It is a no-op only
  // while a flow is already active (prevents a second login tab).
  if (
    event.type === "REQUEST" &&
    state.core !== "authing" &&
    state.core !== "handoff"
  ) {
    // Fresh flow base preserves the SPA tab id so results can be delivered.
    const base: FlowState = {
      ...initialState(event.mode),
      appTabId: state.appTabId ?? null,
    };
    if (!flags.hasKulon) {
      // Always start at SSO (deterministic). We deliberately DON'T skip straight
      // to Kulon based on ambient `hasSso` cookie presence: a stale/guest
      // `ci_session_sso` falsely proves "logged in", which used to send users
      // straight to Kulon's interactive OIDC (Microsoft) — the deprecated path.
      // Advance is decided by the logged-in-page URL signal (isSsoLoggedInUrl)
      // or the SSO cookie gate, so a genuinely valid session still fast-passes
      // without re-prompting. No clearFor('sso') — keep a valid session.
      return {
        state: {
          ...base,
          core: "authing",
          service: "sso",
          deadline: deadline(deps),
          settledAt: 0,
          recentSessionChange: false,
        },
        effects: [
          { kind: "openTab", url: deps.loginUrl("sso") },
          { kind: "scheduleTimers", deadline: deadline(deps) },
        ],
      };
    }
    return {
      state: { ...base, core: "handoff", deadline: deadline(deps) },
      effects: [{ kind: "postHandoff" }],
    };
  }

  if (
    event.type === "TIMEOUT" &&
    (state.core === "authing" || state.core === "handoff")
  ) {
    return {
      state: { ...state, core: "error" },
      effects: [
        { kind: "clearTimers" },
        { kind: "closeAllTabs" },
        {
          kind: "sendResult",
          payload: {
            status: "error",
            message:
              'Login belum selesai dalam batas waktu. Silakan klik "Login via Extension" lagi.',
          },
        },
      ],
    };
  }

  if (
    state.core === "authing" &&
    (event.type === "COOKIE_SET" ||
      event.type === "USER_DONE" ||
      event.type === "TAB_LOADED")
  ) {
    // Tab finished loading. Mark settled; in auto mode, fast-path advance when
    // the target session cookie is already present (redirect ASAP after load).
    if (event.type === "TAB_LOADED") {
      const settled = { ...state, settledAt: deps.now() };
      if (state.mode === "auto") {
        const svc = state.service;
        // SSO: a logged-in page URL is the POSITIVE signal — NOT a cookie change
        // (which never fires for an already-established session). Handles both
        // "already logged in" (fast-pass) and "manual login completed" (page left
        // the form), without trusting ambient cookie presence.
        if (svc === "sso" && isSsoLoggedInUrl(event.url) && flags.hasSso) {
          return advanceAuth({ ...settled, recentSessionChange: false }, deps);
        }
        if (
          state.recentSessionChange &&
          ((svc === "kulon" && flags.hasKulon) ||
            (svc === "siap" && flags.hasSiap))
        ) {
          return advanceAuth({ ...settled, recentSessionChange: false }, deps);
        }
      }
      return { state: settled, effects: [] };
    }

    const triggered =
      state.mode === "semi"
        ? event.type === "USER_DONE"
        : event.type === "COOKIE_SET";
    if (!triggered) return { state, effects: [] };

    // USER_DONE (human) is NEVER gated by the page-load state.
    if (event.type === "USER_DONE") {
      return advanceAuth(state, deps);
    }

    // COOKIE_SET: page-load gate. Real cookie events are only judged once the
    // page has settled; the poll (changed:undefined) forces settle as a bounded
    // fallback so a missed TAB_LOADED can't hang the flow. NOTE: the Kulon/SIAP
    // auto-auth ticket sets its session cookie EARLY in the page load, often
    // before the tab reports `complete`. We must NOT drop that genuinely-meant
    // session cookie change (else the hop waits ~POLL for the alarm) — instead
    // record it so the imminent TAB_LOADED fast-path can advance immediately.
    const isPoll = !event.changed || event.changed.length === 0;
    let base = state;
    if (state.settledAt === 0) {
      if (isPoll) base = { ...state, settledAt: deps.now() };
      else if (
        state.mode === "auto" &&
        sessionCookieChanged(event, state.service)
      ) {
        // A real change of the CURRENT phase's session cookie arrived before
        // the page settled. Don't advance yet (page load isn't stable) but keep
        // the flag so TAB_LOADED (which sets settledAt) fast-paths right after.
        return { state: { ...state, recentSessionChange: true }, effects: [] };
      } else {
        return { state, effects: [] };
      }
    }
    // SSO guard: skip the guest `ci_session_sso` dropped right after settle.
    if (
      base.service === "sso" &&
      deps.now() < base.settledAt + deps.SSO_GUARD_MS
    ) {
      return { state: base, effects: [] };
    }
    // Auto mode: only a change of the CURRENT phase's real session cookie is
    // allowed to advance — csrf/guest/LB cookie events must not.
    if (state.mode === "auto" && !sessionCookieChanged(event, base.service)) {
      return { state: base, effects: [] };
    }
    return advanceAuth({ ...base, recentSessionChange: true }, deps);
  }

  if (state.core === "handoff") {
    switch (event.type) {
      case "HANDOFF_OK":
        return {
          state: { ...state, core: "done" },
          effects: [
            { kind: "clearTimers" },
            {
              kind: "sendResult",
              payload: { status: "ok", accessToken: event.token },
            },
            { kind: "closeAllTabs" },
            { kind: "focusAppTab" },
          ],
        };
      case "HANDOFF_NEEDS_SERVICE":
        const nav: FlowEffect =
          state.tabId == null
            ? { kind: "openTab", url: deps.loginUrl(event.service) }
            : { kind: "navigateTab", url: deps.loginUrl(event.service) };
        return {
          state: {
            ...state,
            core: "authing",
            service: event.service,
            deadline: deadline(deps),
            settledAt: 0,
            recentSessionChange: false,
          },
          effects: [
            ...clearFor(event.service),
            nav,
            { kind: "scheduleTimers", deadline: deadline(deps) },
          ],
        };
      case "HANDOFF_STALE": {
        if (state.reloginCount < deps.MAX_RELOGIN) {
          // Backend said a session is stale. `event.service` tells WHICH one
          // (e.g. KULON_STALE → 'kulon'), so we re-auth that service (clearing
          // its downstream chain) instead of ALWAYS resetting to SSO — a stale
          // Kulon with a still-valid SSO no longer forces an SSO re-login that
          // would just bounce back. Re-login target is decided by the backend's
          // explicit code, NOT by cookie presence (the old "smart kulon hop" on
          // cookie-presence is what looped: stale cookies still show as present).
          // Reuse the SAME login tab (navigate, not closeAllTabs+openTab).
          const target: Service = event.service;
          const nav: FlowEffect =
            state.tabId == null
              ? { kind: "openTab", url: deps.loginUrl(target) }
              : { kind: "navigateTab", url: deps.loginUrl(target) };
          return {
            state: {
              ...state,
              core: "authing",
              service: target,
              reloginCount: state.reloginCount + 1,
              deadline: deadline(deps),
              settledAt: 0,
              recentSessionChange: false,
            },
            effects: [
              ...clearFor(target),
              nav,
              { kind: "scheduleTimers", deadline: deadline(deps) },
            ],
          };
        }
        return {
          state: { ...state, core: "error" },
          effects: [
            { kind: "clearTimers" },
            { kind: "closeAllTabs" },
            {
              kind: "sendResult",
              payload: {
                status: "error",
                message: "Sesi layanan gagal diperbarui. Silakan coba lagi.",
              },
            },
          ],
        };
      }
      case "HANDOFF_ERROR":
        return {
          state: { ...state, core: "error" },
          effects: [
            { kind: "clearTimers" },
            { kind: "closeAllTabs" },
            {
              kind: "sendResult",
              payload: { status: "error", message: event.message },
            },
          ],
        };
      default:
        return { state, effects: [] };
    }
  }

  return { state, effects: [] };
}
