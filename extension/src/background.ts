// MV3 service worker adapter. All Chrome events (external message, cookies
// onChanged, tabs.onUpdated, alarms) funnel into a single serialized `runFlow`
// which drives the pure state machine in core/flow.ts. Side effects (cookie
// read, tab open/navigate/close, storage, HTTP handoff) live ONLY here — the
// core never touches `chrome`.
import {
  initialState,
  advance,
  attachTab,
  redact,
  normalizeState,
  pollStatus,
  isPhaseSatisfied,
  decideHandoffRequest,
  handoffSyncResponse,
  type FlowState,
  type FlowEvent,
  type FlowEffect,
} from "./core/flow.js";
import {
  evaluateCookies,
  buildHandoffBody,
  cookiePatternsForPhase,
  cookieStoreForTab,
} from "./core/cookies.js";
import { interpretHandoff, summarizeHandoff } from "./core/handoff.js";
import {
  DEFAULT_SERVER_URL,
  SSO_LOGIN_URL,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
} from "./core/urls.js";
import type { HandoffRaw, Service, OutboundStatus } from "./core/contract.js";

const SERVER_KEY = "serverUrl";
const STATE_KEY = "ssoLoginState";
const ALARM_KEY = "handoff-timeout";
const POLL_KEY = "handoff-poll";
const LAST_RESULT_KEY = "lastHandoffResult";
const POLL_PERIOD_MIN = 0.5;
const MAX_RELOGIN = 2;
const PHASE_TIMEOUT_MS = 3 * 60_000;
const SSO_GUARD_MS = 1500;
// Debounce window for cookies.onChanged: a page load fires many undip cookie
// events (session, csrf, F5 load-balancer) in a burst. Coalesce them into ONE
// COOKIE_SET carrying the unique changed names instead of N serialized runs.
const COOKIE_DEBOUNCE_MS = 400;

const loginUrl = (s: Service): string =>
  s === "sso"
    ? SSO_LOGIN_URL
    : s === "kulon"
      ? buildKulonTicketUrl()
      : buildSiapTicketUrl();

async function getState(): Promise<FlowState> {
  const res = await chrome.storage.local.get(STATE_KEY);
  const state: FlowState = res[STATE_KEY] ?? initialState("auto");
  // Recover persisted states that are no longer real: terminal done/error
  // without a live tab, or an authing/handoff flow whose phase deadline
  // already passed (SW killed / extension reload — alarms do not survive a
  // reload, so TIMEOUT never fired and the flow stays half-alive forever,
  // blocking every later login with `active:true` and no tab ever opening).
  return normalizeState(state, Date.now());
}
async function setState(s: FlowState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: s });
}

/** True when the given tab still exists in the browser. */
async function tabAlive(tabId: number | null): Promise<boolean> {
  if (tabId == null) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read cookies from the cookie store that owns the login tab. An incarnation
 * of the bug report: incognito login stuck at `sso`. The background reads
 * cookies with bare `chrome.cookies.getAll({})`, which returns ONLY the
 * default (regular) cookie store. When the login tab lives in an incognito
 * window, its session cookies are in the incognito store — so the SSO flag
 * never turned on and the flow could never advance (it timed out instead).
 * Resolving the store from the tab's owns-store fixes cookie detection,
 * handoff body, and cookie clearing for incognito logins.
 */
async function getFlowCookies(
  tabId: number | null,
): Promise<chrome.cookies.Cookie[]> {
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    const storeId = cookieStoreForTab(stores, tabId);
    return await chrome.cookies.getAll(storeId ? { storeId } : {});
  } catch {
    return [];
  }
}
async function getServerUrl(): Promise<string> {
  const res = await chrome.storage.sync.get(SERVER_KEY);
  return (res[SERVER_KEY] as string) || DEFAULT_SERVER_URL;
}
async function fetchHandoff(url: string, body: unknown): Promise<HandoffRaw> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...data };
}

async function clearCookies(service: Service): Promise<void> {
  let stores: { id: string; tabIds: number[] }[] = [];
  try {
    stores = await chrome.cookies.getAllCookieStores();
  } catch {
    stores = [];
  }
  // Clear from EVERY cookie store (regular + each incognito store): a logout
  // or stale re-auth must not leave an incognito session cookie behind.
  const storeIds = stores.length ? stores.map((s) => s.id) : [undefined];
  for (const storeId of storeIds) {
    for (const p of cookiePatternsForPhase(service)) {
      try {
        const cookies = await chrome.cookies.getAll(
          storeId ? { domain: p.domain, storeId } : { domain: p.domain },
        );
        for (const c of cookies) {
          const match =
            typeof p.name === "string"
              ? c.name === p.name
              : p.name.test(c.name);
          if (!match) continue;
          await chrome.cookies
            .remove({
              name: c.name,
              url: `https://${c.domain.replace(/^\./, "")}/`,
              ...(storeId ? { storeId } : {}),
            })
            .catch(() => {});
        }
      } catch {
        /* best-effort */
      }
    }
  }
}

async function clearSessionCookies(): Promise<void> {
  const all: Service[] = ["sso", "kulon", "siap"];
  for (const s of all) await clearCookies(s);
}

async function sendToApp(
  appTabId: number | null,
  payload: OutboundStatus,
): Promise<void> {
  // Cache the final payload so the SPA's self-healing poll ({action:'status'})
  // can recover the JWT even if every push channel is missed. storage.session
  // is in-memory and cleared on browser restart.
  await chrome.storage.session
    .set({ [LAST_RESULT_KEY]: payload })
    .catch(() => {});
  if (appTabId != null) {
    await chrome.tabs
      .sendMessage(appTabId, { action: "handoff-result", ...payload })
      .catch(() => {});
  }
  await chrome.runtime
    .sendMessage({ action: "handoff-result", ...payload })
    .catch(() => {});
  if (appTabId != null) {
    await chrome.tabs.update(appTabId, { active: true }).catch(() => {});
  }
}

/**
 * Non-secret cookie diagnostics: WHICH cookie names exist per service at the
 * moment of the handoff (values are NEVER logged). Lets us see whether the
 * browser actually holds a MoodleSession (and on which domain) when the
 * backend rejects it as stale.
 */
function cookieNamesDiag(cookies: { name: string; domain: string }[]) {
  return {
    kulon: cookies
      .filter((c) => c.domain.includes("kulon2.undip.ac.id"))
      .map((c) => ({ name: c.name, domain: c.domain })),
    sso: cookies
      .filter((c) => c.domain.includes("sso.undip.ac.id"))
      .map((c) => ({ name: c.name, domain: c.domain })),
    siap: cookies
      .filter((c) => c.domain.includes("siap.undip.ac.id"))
      .map((c) => ({ name: c.name, domain: c.domain })),
    microsoft: cookies
      .filter(
        (c) =>
          c.domain.includes("microsoftonline.com") ||
          c.domain.includes("login.live.com"),
      )
      .map((c) => ({ name: c.name, domain: c.domain })),
  };
}

/**
 * Run the handoff HTTP call and translate the backend result into the next
 * state-machine event. Called by the `postHandoff` effect, which re-enters the
 * loop with this event to keep everything within a single lock pass.
 */
async function postHandoffDecision(_state: FlowState): Promise<FlowEvent> {
  const cookies = await getFlowCookies(_state.tabId);
  console.info(
    "[Undip SSO] handoff cookie names",
    JSON.stringify(cookieNamesDiag(cookies)),
  );
  const serverUrl = (await getServerUrl()).replace(/\/+$/, "");
  const raw = await fetchHandoff(
    `${serverUrl}/api/auth/session/handoff`,
    buildHandoffBody(cookies),
  );
  console.info("[Undip SSO] handoff", summarizeHandoff(raw));
  const decision = interpretHandoff(raw);
  if (decision.action === "ok")
    return { type: "HANDOFF_OK", token: decision.token };
  if (decision.action === "needsService")
    return { type: "HANDOFF_NEEDS_SERVICE", service: decision.service };
  if (decision.action === "stale")
    return { type: "HANDOFF_STALE", service: decision.service };
  return { type: "HANDOFF_ERROR", message: decision.message };
}

/** Apply a single effect, returning an optional follow-up event + possibly
 *  updated state (tab id from openTab) for the next loop iteration. */
async function applyEffect(
  state: FlowState,
  e: FlowEffect,
): Promise<{ state: FlowState; follow?: FlowEvent }> {
  switch (e.kind) {
    case "openTab": {
      const tab = await chrome.tabs.create({ url: e.url });
      return { state: attachTab(state, tab.id ?? -1) };
    }
    case "navigateTab": {
      if (state.tabId != null)
        await chrome.tabs.update(state.tabId, { url: e.url }).catch(() => {});
      return { state };
    }
    case "closeAllTabs": {
      for (const id of state.tabs) await chrome.tabs.remove(id).catch(() => {});
      return { state: { ...state, tabs: [], tabId: null } };
    }
    case "clearCookies":
      await clearCookies(e.service);
      return { state };
    case "postHandoff": {
      const follow = await postHandoffDecision(state);
      return { state, follow };
    }
    case "sendResult":
      await sendToApp(state.appTabId, e.payload);
      return { state };
    case "focusAppTab":
      if (state.appTabId != null)
        await chrome.tabs
          .update(state.appTabId, { active: true })
          .catch(() => {});
      return { state };
    case "scheduleTimers": {
      await chrome.alarms
        .create(ALARM_KEY, { when: e.deadline })
        .catch(() => {});
      await chrome.alarms
        .create(POLL_KEY, { periodInMinutes: POLL_PERIOD_MIN })
        .catch(() => {});
      return { state };
    }
    case "clearTimers":
      await chrome.alarms.clear(ALARM_KEY).catch(() => {});
      await chrome.alarms.clear(POLL_KEY).catch(() => {});
      return { state };
    default:
      return { state };
  }
}

let runBusy = false;
// Event that arrived while the flow was busy — replay it right after the
// current pass instead of silently dropping it (a dropped COOKIE_SET used to
// stall the cascade until the next alarm tick).
let pendingEvent: FlowEvent | null = null;

/**
 * Single serialized entry point. Reads state + cookies, feeds the event into
 * the pure state machine, applies generated effects, and — when an effect
 * yields a follow-up event (e.g. HANDOFF_*) — continues within the same pass.
 * Any event that arrives while this runs is parked in `pendingEvent` and
 * drained immediately after, so no cookie change is ever lost.
 */
async function runFlow(initialEvent: FlowEvent): Promise<void> {
  if (runBusy) {
    pendingEvent = initialEvent;
    return;
  }
  runBusy = true;
  try {
    let event: FlowEvent | null = initialEvent;
    let guard = 0;
    // Process the initial event, its follow-up chain (handoff decisions), AND
    // any events that arrived while we were inside effects — `pendingEvent` is
    // drained inline so nothing is lost and nothing reconstructs the lock.
    while ((event !== null || pendingEvent !== null) && guard < 20) {
      guard++;
      const ev: FlowEvent = event ?? (pendingEvent as FlowEvent);
      pendingEvent = null; // consumed below (fresh ones re-arrive via listeners)
      const state = await getState();
      const cookies = await getFlowCookies(state.tabId);
      const flags = evaluateCookies(cookies);
      const deps = {
        flags,
        now: Date.now,
        MAX_RELOGIN,
        PHASE_TIMEOUT_MS,
        SSO_GUARD_MS,
        loginUrl,
      };
      console.info("[Undip SSO] transition", ev.type, {
        ...redact(state),
        flags,
      });
      const { state: next, effects } = advance(state, ev, deps);

      let current = next;
      let follow: FlowEvent | null = null;
      for (const e of effects) {
        const r = await applyEffect(current, e);
        if (r.follow) follow = r.follow;
        current = r.state;
      }
      await setState(current);
      // Follow-up (handoff → HANDOFF_*) takes precedence; otherwise pick up a
      // parked event so e.g. a cookie change mid-pass is not lost.
      event = follow ?? pendingEvent;
      if (event !== follow) pendingEvent = null;
    }
  } finally {
    runBusy = false;
  }
}

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    void (async () => {
      const appTabId = sender?.tab?.id ?? null;
      console.info(
        "[Undip SSO] external action",
        (message as { action?: string })?.action,
        { senderTabId: appTabId },
      );
      try {
        switch ((message as { action?: string })?.action) {
          case "ping":
            return void sendResponse({ status: "ok" });
          case "status": {
            // Self-healing poll: return the last completed handoff result when
            // one exists (lets the SPA recover the JWT), otherwise report the
            // current flow state. pollStatus converts an inactive+no-result flow
            // to a terminal error so the SPA polling loop can settle instead of
            // hanging forever on a dead flow.
            const cached = (await chrome.storage.session.get(LAST_RESULT_KEY))[
              LAST_RESULT_KEY
            ] as OutboundStatus | undefined;
            const s = await getState();
            return void sendResponse(pollStatus(cached, s));
          }
          case "logout":
            // Full teardown so the next login starts clean: clear session cookies,
            // reset the flow state machine (closes login tabs + clears timers), and
            // drop any cached handoff result so a stale JWT can't resurface via the
            // status poll after an explicit logout.
            await clearSessionCookies();
            await chrome.storage.session
              .remove(LAST_RESULT_KEY)
              .catch(() => {});
            await runFlow({ type: "LOGOUT" });
            return void sendResponse({ status: "ok" });
          case "done": {
            await runFlow({ type: "USER_DONE" });
            return void sendResponse({ status: "started" });
          }
          case "handoff": {
            let state = await getState();
            // A fresh flow must not inherit a stale completed result (e.g. a
            // previous login's JWT surfacing via the status poll).
            await chrome.storage.session
              .remove(LAST_RESULT_KEY)
              .catch(() => {});
            // Pre-run policy (zombie recovery, wedged-phase reset, double-start
            // guard) is decided in core/flow.ts; the adapter gathers the
            // chrome.* inputs and executes the returned decision.
            const decision = decideHandoffRequest({
              state,
              tabAlive: await tabAlive(state.tabId),
              phaseSatisfied: isPhaseSatisfied(
                state,
                evaluateCookies(await getFlowCookies(state.tabId)),
              ),
            });
            if (decision.kind === "reset") {
              console.info(
                decision.reason === "zombie-tab"
                  ? "[Undip SSO] zombie flow: login tab gone — resetting"
                  : "[Undip SSO] wedged in a satisfied phase — resetting",
                { core: state.core, tabId: state.tabId, service: state.service },
              );
              state = initialState(state.mode);
            } else if (decision.kind === "already-started") {
              return void sendResponse({
                status: "started",
                mode: decision.mode,
                message: "Login sedang berjalan.",
              });
            }
            await setState({ ...state, appTabId });
            await runFlow({ type: "REQUEST", mode: "auto" });
            const after = await getState();
            // In-pass finish/failure interpretation + cached-result replay:
            // decided in core, executed here.
            const cached = (
              await chrome.storage.session.get(LAST_RESULT_KEY)
            )[LAST_RESULT_KEY] as OutboundStatus | undefined;
            return void sendResponse(handoffSyncResponse(after, cached));
          }
          default:
            return void sendResponse({
              status: "error",
              message: "Unknown action",
            });
        }
      } catch (err) {
        sendResponse({
          status: "error",
          message: (err as Error)?.message ?? "Error internal",
        });
      }
    })();
    return true;
  },
);

// Debounce buffer for cookies.onChanged. The state machine must not see every
// cookie event of a page load (session + csrf + F5 load-balancer cookies all
// fire in the same burst) — only ONE COOKIE_SET with the unique changed names.
let pendingCookieNames: string[] = [];
let cookieDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushCookieChange() {
  cookieDebounceTimer = null;
  const names = [...new Set(pendingCookieNames)];
  pendingCookieNames = [];
  if (names.length === 0) return;
  void runFlow({ type: "COOKIE_SET", changed: names }).catch(() => {});
}

chrome.cookies.onChanged.addListener((info) => {
  if (!info.cookie?.domain?.includes("undip.ac.id")) return;
  if (info.cookie.name) pendingCookieNames.push(info.cookie.name);
  if (cookieDebounceTimer) clearTimeout(cookieDebounceTimer);
  cookieDebounceTimer = setTimeout(flushCookieChange, COOKIE_DEBOUNCE_MS);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    const s = await getState();
    if (s.tabId === tabId && s.core === "authing") {
      // Use the `tab` argument from onUpdated (not chrome.tabs.get): its `url`
      // is populated reliably for MV3, whereas tabs.get().url can be undefined
      // at status:'complete' (esp. on incognito). This is the positive SSO
      // login signal (isSsoLoggedInUrl) — missing it wedged the sso phase.
      const url = tab?.url;
      await runFlow({ type: "TAB_LOADED", url }).catch(() => {});
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_KEY)
    void runFlow({ type: "TIMEOUT" }).catch(() => {});
  if (alarm.name === POLL_KEY)
    void runFlow({ type: "COOKIE_SET" }).catch(() => {});
});
