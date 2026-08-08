// MV3 service worker — orchestrates the CDP-style login flow:
//   1. Web app sends {action:'handoff'} → we open ONE tab to the missing
//      service (Kulon first, then SIAP in the SAME tab).
//   2. chrome.cookies.onChanged wakes us the instant a login cookie is set
//      (event-driven — no polling, SW only wakes when something changes).
//   3. When both cookies are present we POST the handoff, forward the result
//      to the SPA via the content-script bridge, and close the tab.
//   4. A chrome.alarms deadline (3 min/service, like the CDP flow) guards
//      against the user never finishing the login.
import {
  handleHandoffMessage,
  performHandoff,
  nextAction,
  nextHandoffStep,
  evaluateCookies,
  DEFAULT_SERVER_URL,
  SSO_LOGIN_URL,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
  PHASE_TIMEOUT_MS,
  cookiePatternsForPhase,
  phasesToClear,
} from './messages.js';

const STORAGE_KEY = 'serverUrl';
const STATE_KEY = 'ssoLoginState';
const ALARM_KEY = 'handoff-timeout';
// Periodic safety-net poll so the orchestration does not depend 100% on
// chrome.cookies.onChanged (which can be "missed" when breaking a lazy
// navigation does not actually change a cookie — e.g. re-opening an SSO page
// whose session is already live). Chrome clamps packed alarms to ~30s minimum.
const POLL_KEY = 'handoff-poll';
const POLL_PERIOD_MIN = 0.5;
// Last completed handoff payload, cached in session storage so the SPA can
// recover the JWT even if every content-bridge push was missed. `storage.session`
// is in-memory and cleared on browser restart — never persisted to disk.
const LAST_RESULT_KEY = 'lastHandoffResult';
// Cap automatic re-login pivots so a cookie that flips stale mid-flow (or a
// rapid cookies.onChanged burst) cannot loop reopening login tabs forever.
const RELOGIN_MAX = 2;

function deps() {
  return {
    getCookies: () => chrome.cookies.getAll({}),
    getServerUrl: async () => {
      const { [STORAGE_KEY]: url } = await chrome.storage.sync.get(STORAGE_KEY);
      return url || DEFAULT_SERVER_URL;
    },
    fetchHandoff: async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, ...data };
    },
    openTab: async (url) => ({ id: (await chrome.tabs.create({ url })).id }),
    navigateTab: (id, url) => chrome.tabs.update(id, { url }),
    closeTab: (id) => chrome.tabs.remove(id),
    getLastResult: async () => {
      const { [LAST_RESULT_KEY]: last } = await chrome.storage.session.get(LAST_RESULT_KEY);
      return last ?? null;
    },
    // Current orchestration state (may be null). Used by handleHandoffMessage to
    // detect an already-active flow so a re-click cannot open a second login tab.
    getFlowState: async () => getState(),
    setLastResult: async (payload) => {
      await chrome.storage.session.set({ [LAST_RESULT_KEY]: payload });
    },
    clearLastResult: async () => {
      await chrome.storage.session.remove(LAST_RESULT_KEY);
    },
    // Remove the SSO/Kulon/SIAP session cookies so a later login cannot reuse a
    // stale session and is forced to open a fresh tab. Best-effort per cookie so
    // one failure never aborts the whole logout.
    clearSessionCookies: async () => {
      const patterns = [
        { domain: 'sso.undip.ac.id', name: 'ci_session_sso' },
        { domain: 'undip.ac.id', name: 'ci_session_sso' },
        { domain: 'kulon2.undip.ac.id', name: /^MoodleSession/ },
        { domain: 'siap.undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
        { domain: 'undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
      ];
      for (const p of patterns) {
        try {
          const cookies = await chrome.cookies.getAll({ domain: p.domain });
          for (const c of cookies) {
            if (typeof p.name === 'string' ? c.name === p.name : p.name.test(c.name)) {
              // chrome.cookies.remove needs a URL matching the cookie's domain.
              await chrome.cookies
                .remove({ name: c.name, url: `https://${c.domain.replace(/^\./, '')}/` })
                .catch(() => {});
            }
          }
        } catch {
          /* best-effort */
        }
      }
    },
    kulonLoginUrl: buildKulonTicketUrl(),
    siapLoginUrl: buildSiapTicketUrl(),
    ssoLoginUrl: SSO_LOGIN_URL,
  };
}

async function getState() {
  const { [STATE_KEY]: state } = await chrome.storage.local.get(STATE_KEY);
  return state ?? null;
}

async function setState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function clearState() {
  await chrome.storage.local.remove(STATE_KEY);
}

async function sendResult(payload) {
  // Cache the payload in session storage first so the SPA can recover it via
  // the {action:'result'} poll even if both push channels below are missed.
  await deps().setLastResult(payload).catch(() => {});
  const state = await getState();
  const appTabId = state?.appTabId;
  // Primary: direct to the SPA's content-script bridge (most reliable — we
  // recorded the app tab when the handoff message arrived).
  if (appTabId != null) {
    await chrome.tabs.sendMessage(appTabId, { action: 'handoff-result', ...payload }).catch(() => {});
  }
  // Fallback: broadcast to all extension contexts (legacy path).
  await chrome.runtime.sendMessage({ action: 'handoff-result', ...payload }).catch(() => {});
  // Bring the app tab to the foreground so the user lands back in the app
  // without hunting for the right tab.
  if (appTabId != null) {
    await chrome.tabs.update(appTabId, { active: true }).catch(() => {});
  }
}

async function fail(message) {
  await sendResult({ status: 'error', message });
  const state = await getState();
  await closeAllFlowTabs(state);
  await chrome.alarms.clear(ALARM_KEY);
  await chrome.alarms.clear(POLL_KEY);
  await clearState();
}

/**
 * Open the first missing-service login tab, persist the orchestration state,
 * and arm the per-service deadline + periodic poll. `requestedPhase` forces a
 * specific phase (used when a stale session must be re-established). Phase order
 * mirrors the working CDP flow: central Kazan SSO first, then Kulon and SIAP
 * auto-login via the SSO session ("sso" → "kulon" → "siap" → handoff).
 */
async function startLogin(deps, requestedPhase, reloginCount = 0, appTabId = null) {
  const cookies = await chrome.cookies.getAll({});
  const { hasSso, hasKulon } = evaluateCookies(cookies);
  // `requestedPhase` may be 'sso' while the central SSO session is already live
  // (e.g. a relogin where only Kulon went stale). Opening the SSO login page in
  // that case changes no cookie → chrome.cookies.onChanged never fires → the
  // flow deadlocks until the timeout. Skip the already-live SSO and go straight
  // to the next service that needs re-establishment.
  let phase = requestedPhase ?? (!hasSso ? 'sso' : hasKulon ? 'siap' : 'kulon');
  if (requestedPhase === 'sso' && hasSso) {
    phase = hasKulon ? 'siap' : 'kulon';
  }
  const loginUrl =
    phase === 'sso'
      ? deps.ssoLoginUrl
      : phase === 'kulon'
        ? deps.kulonLoginUrl
        : deps.siapLoginUrl;
  // Clear the stale session cookies of this phase AND its downstream cascade
  // BEFORE opening the login tab. A stale cookie (Kulon/SIAP/SSO expired
  // server-side but still present in the browser) otherwise makes processCookies
  // immediately POST a handoff — which the backend rejects as expired — on
  // every tab load, producing the fast open→close→reopen loop. With the stale
  // cookie gone, evaluateCookies reports the service as logged-out and the flow
  // waits for the user to actually log in.
  for (const p of phasesToClear(phase)) {
    await clearCookiesForPhase(p);
  }
  const { id } = await chrome.tabs.create({ url: loginUrl });
  const existing = await getState();
  // Keep every tab this flow created so cleanup can close them all (prevents
  // orphan tabs from a relogin pivot). `tabId` stays the current login tab.
  const tabs = [...(existing?.tabs ?? []), id];
  await setState({
    tabId: id,
    tabs,
    phase,
    deadline: Date.now() + PHASE_TIMEOUT_MS,
    reloginCount,
    ...(appTabId != null ? { appTabId } : {}),
  });
  await chrome.alarms.create(ALARM_KEY, { when: Date.now() + PHASE_TIMEOUT_MS });
  await chrome.alarms.create(POLL_KEY, { periodInMinutes: POLL_PERIOD_MIN }).catch(() => {});
}

// Global lock so only ONE flow mutation (startLogin / processCookies) runs at a
// time. MV3 wakes the SW on several independent events (cookies.onChanged,
// tabs.onUpdated, alarms) — without serializing these, two of them could each
// call startLogin → duplicate login tabs.
let flowBusy = false;

async function withFlowLock(fn) {
  if (flowBusy) return;
  flowBusy = true;
  try {
    await fn();
  } finally {
    flowBusy = false;
  }
}

/** Navigate/remove the login tab. If the user closed it mid-flow, surface a
 *  clear message instead of a raw "No tab with id" error or a silent loop. */
async function runTabAction(tabId, action) {
  try {
    await action();
  } catch (err) {
    const msg = err?.message ?? '';
    if (/No tab with id|not found/i.test(msg)) {
      throw new Error('Tab login ditutup. Silakan klik "Login via Extension" lagi.');
    }
    throw err;
  }
}

/** Close every tab this flow created (all relogin pivots included). */
async function closeAllFlowTabs(state) {
  const ids = state?.tabs?.length ? state.tabs : state?.tabId != null ? [state.tabId] : [];
  for (const id of ids) {
    await chrome.tabs.remove(id).catch(() => {});
  }
}

/**
 * Remove the stale session cookies of a single service phase, best-effort per
 * cookie so one failure never aborts the orchestration. Clearing is the key to
 * breaking the close/reopen loop: a stale MoodleSession/sia_app_session cookie
 * stays in the browser after server-side expiry, so `evaluateCookies` keeps
 * reporting the service as "logged in" and `processCookies` immediately re-POSTs
 * a handoff the backend rejects as expired — over and over. Removing the stale
 * cookie first makes the orchestration truly wait for the user to log in again.
 */
async function clearCookiesForPhase(phase) {
  for (const p of cookiePatternsForPhase(phase)) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: p.domain });
      for (const c of cookies) {
        if (typeof p.name === 'string' ? c.name === p.name : p.name.test(c.name)) {
          await chrome.cookies
            .remove({ name: c.name, url: `https://${c.domain.replace(/^\./, '')}/` })
            .catch(() => {});
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

/** One processing pass after a cookie change or timer. */
async function processCookies() {
  await withFlowLock(async () => {
    const state = await getState();
    if (!state) return;
    const cookies = await chrome.cookies.getAll({});
    const action = nextAction(state, cookies);

    if (action === 'open-kulon') {
      // SSO done — navigate the SAME tab to the Kulon ticket (SSO-propagates to
      // Kulon, Mirrors the CDP flow). Microsoft OIDC may still require a sign-in.
      await runTabAction(state.tabId, () => chrome.tabs.update(state.tabId, { url: buildKulonTicketUrl() }));
      await setState({ ...state, phase: 'kulon', deadline: Date.now() + PHASE_TIMEOUT_MS });
      return;
    }

    if (action === 'open-siap') {
      // Kulon done — navigate the SAME tab to SIAP (Microsoft session already
      // exists, so it auto-logs-in).
      await runTabAction(state.tabId, () => chrome.tabs.update(state.tabId, { url: buildSiapTicketUrl() }));
      await setState({ ...state, phase: 'siap', deadline: Date.now() + PHASE_TIMEOUT_MS });
      return;
    }

    if (action === 'handoff') {
      const result = await performHandoff(deps(), cookies);
      const step = nextHandoffStep(result);
      if (step.action === 'open') {
        // The backend verified the handoff but reports at least one service
        // invalid (e.g. a stale SIAP session that is still present in the
        // browser). Re-capture that service in the SAME tab instead of sending
        // an "ok" for an incomplete session (which used to surface as a 500 on
        // the SIAP page). Reuse is only allowed when ALL services are verified.
        // Clear the stale cookie first so the next processCookies pass waits for
        // a FRESH one instead of immediately re-handoffing the same stale one
        // (which would loop the tab through its own login page forever).
        for (const p of phasesToClear(step.phase)) {
          await clearCookiesForPhase(p);
        }
        const url =
          step.phase === 'sso'
            ? deps().ssoLoginUrl
            : step.phase === 'kulon'
              ? deps().kulonLoginUrl
              : deps().siapLoginUrl;
        await runTabAction(state.tabId, () => chrome.tabs.update(state.tabId, { url }));
        await setState({ ...state, phase: step.phase, deadline: Date.now() + PHASE_TIMEOUT_MS });
        return;
      }
      // The backend rejected the Kulon session as stale (e.g. it expired before
      // the handoff, or a pre-auth cookie set during the Microsoft OIDC redirect
      // was captured while the session was not yet live). Re-establish from the
      // central Kazan SSO session — Kulon and SIAP then re-follow automatically
      // — instead of failing permanently. The reloginCount check is done against
      // a freshly-read state (inside the flow lock) so two queued passes cannot
      // both read the same count and each spawn a new tab.
      const freshState = await getState();
      const reloginCount = freshState?.reloginCount ?? 0;
      if (!result.ok && result.code === 'KULON_STALE' && reloginCount < RELOGIN_MAX) {
        await closeAllFlowTabs(freshState);
        await startLogin(deps(), 'sso', reloginCount + 1, freshState?.appTabId ?? null);
        await sendResult({ status: 'started', relogin: true });
        return;
      }
      await sendResult(
        step.action === 'ok'
          ? { status: 'ok', accessToken: result.accessToken }
          : { status: 'error', message: result.message },
      );
      await closeAllFlowTabs(state);
      await chrome.alarms.clear(ALARM_KEY);
      await chrome.alarms.clear(POLL_KEY);
      await clearState();
      return;
    }

    // action === 'wait' → nothing to do; the cookies.onChanged listener or the
    // alarm will drive the next pass.
  });
}

// --- Message from the SPA (externally_connectable) ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // The SPA tab that initiated the flow — used to deliver the final result
  // directly and to focus the app tab when the login completes.
  const appTabId = sender?.tab?.id ?? null;
  handleHandoffMessage(message, deps())
    .then((res) => {
      if (res.status === 'started' && res.resume) {
        // A flow is ALREADY running with a login tab open (the user re-clicked
        // while waiting). Do NOT open a second tab — keep the existing flow and
        // tell the SPA to keep waiting.
        sendResponse({
          status: 'started',
          relogin: false,
          incomplete: false,
          phase: res.phase,
        });
      } else if (res.status === 'started' || res.status === 'relogin') {
        // Begin (or re-begin) the orchestrated flow: open a login tab for the
        // missing service and arm the per-service deadline. 'relogin' means the
        // captured session went stale — `res.phase` already resolves whether to
        // restart from SSO or (if SSO is still live) re-open the stale service
        // directly. 'started' also carries which service is missing in `res.phase`.
        // withFlowLock serializes this against processCookies so a second handoff
        // message while a flow is already running cannot open a duplicate tab.
        withFlowLock(() => startLogin(deps(), res.phase, 0, appTabId))
          .then(() =>
            sendResponse({
              status: 'started',
              relogin: res.status === 'relogin',
              incomplete: res.incomplete,
            }),
          )
          .catch((err) =>
            sendResponse({ status: 'error', message: err.message ?? 'Error internal' }),
          );
      } else {
        sendResponse(res);
      }
    })
    .catch((err) => sendResponse({ status: 'error', message: err.message ?? 'Error internal' }));
  return true; // keep the message channel open for the async response
});

// --- Event-driven wakeup: a cookie changed (e.g. login completed) ---
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo?.cookie?.domain?.includes('undip.ac.id')) return;
  processCookies().catch((err) => {
    fail(err.message ?? 'Error internal').catch(() => {});
  });
});

// --- Deterministic kick: every time the flow's login tab finishes loading a page
// we re-evaluate cookies. Gated to the exact tab we orchestrate (state.tabId) so
// unrelated tabs' loads never advance the flow. Catches the case where a session
// cookie is set without a cookies.onChanged event we can observe (e.g. a lazy
// redirect that only rewrites a path, or a cookie flipped while the SW was
// suspended). This makes the Kulon→SIAP→handoff cascade advance on its own
// instead of stalling until the user re-clicks.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const state = getState();
  state
    .then((s) => {
      if (s && tabId === s.tabId) return processCookies();
    })
    .catch((err) => {
      fail(err.message ?? 'Error internal').catch(() => {});
    });
});

// --- Deadline guard: user did not finish the login in time ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_KEY) {
    fail('Login belum selesai dalam batas waktu. Silakan klik "Login via Extension" lagi.').catch(
      () => {},
    );
    return;
  }
  if (alarm.name === POLL_KEY) {
    // Periodic safety-net: re-run the orchestration in case a cookie change was
    // missed. processCookies is idempotent and exits immediately with no active
    // state (isProcessing lock + getState() == null).
    processCookies().catch(() => {});
  }
});
