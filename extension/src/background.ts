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
import { interpretHandoff, summarizeHandoff, networkFailureMessage } from "./core/handoff.js";
import {
  DEFAULT_SERVER_URL,
  SSO_LOGIN_URL,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
} from "./core/urls.js";
import type { HandoffRaw, Service, OutboundStatus } from "./core/contract.js";
import { createLifecycleCoordinator } from "./core/single-flight.js";
import { createSerializedFlowRunner } from "./core/flow-runner.js";
import { performHandoff, performLogout, performStatus } from "./core/lifecycle.js";

const SERVER_KEY = "serverUrl";
const STATE_KEY = "ssoLoginState";
const ALARM_KEY = "handoff-timeout";
const POLL_KEY = "handoff-poll";
const LAST_RESULT_KEY = "lastHandoffResult";
const EPOCH_KEY = "ssoOperationEpoch";
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
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // TypeError jaringan ("Failed to fetch" dsb.) — terjemahkan ke pesan
    // ramah yang menyebut host + Server URL, bukan teks mentah browser.
    return { ok: false, status: 0, message: networkFailureMessage(url) };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...data };
}

async function clearCookies(service: Service): Promise<boolean> {
  let complete = true;
  let stores: { id: string; tabIds: number[] }[] = [];
  try {
    stores = await chrome.cookies.getAllCookieStores();
  } catch (err) {
    console.warn("[Undip SSO] cookie-store enumeration failed", { service, err });
    complete = false;
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
          try {
            const removed = await chrome.cookies.remove({
              name: c.name,
              url: `https://${c.domain.replace(/^\./, "")}${c.path.startsWith("/") ? c.path : `/${c.path}`}`,
              storeId: c.storeId,
              ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
            });
            if (!removed) {
              console.warn("[Undip SSO] cookie removal returned no cookie", {
                service,
                storeId: c.storeId,
                name: c.name,
              });
              complete = false;
            }
          } catch (err) {
            console.warn("[Undip SSO] cookie removal failed", {
              service,
              storeId: c.storeId,
              name: c.name,
              err,
            });
            complete = false;
          }
        }
      } catch (err) {
        console.warn("[Undip SSO] cookie enumeration failed", {
          service,
          storeId,
          err,
        });
        complete = false;
      }
    }
  }
  return complete;
}

async function clearSessionCookies(): Promise<boolean> {
  let complete = true;
  const all: Service[] = ["sso", "kulon", "siap"];
  for (const s of all) {
    if (!(await clearCookies(s))) complete = false;
  }
  return complete;
}

/**
 * Tagged removal: delete the cached handoff result ONLY when it belongs to
 * `epoch`. The epoch is persisted in storage.session alongside the result so
 * an MV3 service-worker restart cannot resurrect a stale result: after a
 * restart the SW restores the persisted epoch, a cached result tagged with an
 * OLDER epoch is rejected by every poll, and logout (which bumps the epoch
 * before removing) can never wipe a result a NEWER login just cached.
 */
async function removeResultForEpoch(epoch: number): Promise<boolean> {
  try {
    const res = await chrome.storage.session.get([LAST_RESULT_KEY, EPOCH_KEY]);
    const cachedEpoch = res[EPOCH_KEY] as number | undefined;
    if (cachedEpoch === undefined || cachedEpoch === epoch) {
      // Untagged (pre-persistence) or current-epoch: remove outright.
      await chrome.storage.session.remove([LAST_RESULT_KEY, EPOCH_KEY]);
      return true;
    }
    // Tagged with ANOTHER epoch: a NEWER login cached a result while this
    // operation was tearing down (or an SW restart restored an older epoch).
    // Remove the result anyway — a logout must never leave a token behind —
    // and reset the epoch to the caller's so the next persist is consistent.
    await chrome.storage.session.remove([LAST_RESULT_KEY, EPOCH_KEY]);
    return true;
  } catch (err) {
    console.warn("[Undip SSO] tagged handoff result removal failed", err);
    return false;
  }
}

/** Read the persisted operation epoch (0 when absent). */
async function getPersistedEpoch(): Promise<number> {
  try {
    const res = await chrome.storage.session.get(EPOCH_KEY);
    const value = res[EPOCH_KEY] as number | undefined;
    return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;
  } catch {
    return 0;
  }
}

/** Persist the current operation epoch (best-effort; storage.session only). */
async function persistEpoch(epoch: number): Promise<void> {
  await chrome.storage.session
    .set({ [EPOCH_KEY]: epoch })
    .catch((err) =>
      console.warn("[Undip SSO] epoch persistence failed", { epoch, err }),
    );
}

async function sendToApp(
  appTabId: number | null,
  payload: OutboundStatus,
): Promise<void> {
  // Cache the final payload so the SPA's self-healing poll ({action:'status'})
  // can recover the JWT even if every push channel is missed. storage.session
  // is in-memory and cleared on browser restart. The payload is tagged with
  // the CURRENT operation epoch so a status poll after an epoch change (logout
  // or an SW restart that restored a persisted epoch) rejects it instead of
  // replaying a stale token.
  await chrome.storage.session
    .set({
      [LAST_RESULT_KEY]: payload,
      [EPOCH_KEY]: lifecycle.currentEpoch(),
    })
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

const lifecycle = createLifecycleCoordinator();

/** Adopt the persisted operation epoch once, on SW start (idle only: at this
 *  point no flow is running — the SW was just (re)started). A pre-restart
 *  handoff result in storage.session then stays fenced behind its own epoch
 *  instead of becoming reachable under the fresh in-memory epoch 0. */
void getPersistedEpoch().then((persisted) => {
  if (persisted > 0) lifecycle.restoreEpoch(persisted);
});

/**
 * Single serialized entry point. Reads state + cookies, feeds the event into
 * the pure state machine, applies generated effects, and — when an effect
 * yields a follow-up event (e.g. HANDOFF_*) — continues within the same pass.
 * Any event that arrives while this runs is parked and drained immediately
 * after, so no cookie change is ever lost. Callers that arrive during an
 * active run join its promise and do not observe completion until their
 * parked event has been consumed or discarded.
 */
const runFlow = createSerializedFlowRunner(async (ev) => {
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
  return { after: current, follow };
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    const action = (message as { action?: string })?.action;
    let messageEpoch: number;
    if (action === "logout") {
      lifecycle.invalidate();
      messageEpoch = lifecycle.currentEpoch();
    } else {
      messageEpoch =
        action === "handoff"
          ? lifecycle.beginHandoff()
          : lifecycle.currentEpoch();
    }
    void persistEpoch(lifecycle.currentEpoch());
    void (async () => {
      const appTabId = sender?.tab?.id ?? null;
      console.info(
        "[Undip SSO] external action",
        action,
        { senderTabId: appTabId },
      );
      try {
        if (action === "logout") {
          // Full teardown so the next login starts clean: clear session cookies,
          // reset the flow state machine (closes login tabs + clears timers), and
          // drop any cached handoff result so a stale JWT can't resurface via the
          // status poll after an explicit logout. Run the state transition first
          // so a handoff already in progress cannot cache a fresh token after
          // these cleanup operations.
          const result = await lifecycle.enqueue(() =>
            performLogout({
              runLogout: () => runFlow({ type: "LOGOUT" }),
              clearSessionCookies,
              // Bound at CALL time (epoch already invalidated above): a fresh
              // login started while teardown runs gets a NEWER epoch and its
              // result is never wiped by this logout.
              removeResult: (epoch) => removeResultForEpoch(epoch),
              onFlowError: (err) =>
                console.warn(
                  "[Undip SSO] flow teardown failed; continuing cleanup",
                  err,
                ),
              onIncomplete: (details) =>
                console.error("[Undip SSO] logout cleanup incomplete", details),
            }),
          );
          return void sendResponse(result);
        }
        if (action === "handoff") {
          const response = await lifecycle.handoff(
            messageEpoch,
            () =>
              performHandoff({
                requestEpoch: messageEpoch,
                currentEpoch: lifecycle.currentEpoch,
                appTabId,
                deps: {
                  getState,
                  setState,
                  removeResult: removeResultForEpoch,
                  tabAlive,
                  getFlowCookies,
                  runFlow,
                  getCachedResult: async () =>
                    (
                      await chrome.storage.session.get(LAST_RESULT_KEY)
                    )[LAST_RESULT_KEY] as OutboundStatus | undefined,
                  onReset: (state, reason) =>
                    console.info(
                      reason === "zombie-tab"
                        ? "[Undip SSO] zombie flow: login tab gone — resetting"
                        : "[Undip SSO] wedged in a satisfied phase — resetting",
                      { core: state.core, tabId: state.tabId, service: state.service },
                    ),
                },
              }),
          );
          return void sendResponse(response);
        }
        if (action === "status") {
          // Self-healing poll: return the last completed handoff result when
          // one exists (lets the SPA recover the JWT), otherwise report the
          // current flow state. pollStatus converts an inactive+no-result flow
          // to a terminal error so the SPA polling loop can settle instead of
          // hanging forever on a dead flow.
          const response = await performStatus({
            requestEpoch: messageEpoch,
            currentEpoch: lifecycle.currentEpoch,
            deps: {
              getCachedResult: async () =>
                (
                  await chrome.storage.session.get(LAST_RESULT_KEY)
                )[LAST_RESULT_KEY] as OutboundStatus | undefined,
              getState,
            },
          });
          return void sendResponse(response);
        }
        if (action === "done") {
          await runFlow({ type: "USER_DONE" });
          return void sendResponse({ status: "started" });
        }
        if (action === "ping") {
          return void sendResponse({ status: "ok" });
        }
        return void sendResponse({
          status: "error",
          message: "Unknown action",
        });
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
