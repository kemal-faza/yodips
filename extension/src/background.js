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
  // Forward to the SPA via the content-script bridge (all extension contexts).
  await chrome.runtime.sendMessage({ action: 'handoff-result', ...payload }).catch(() => {});
}

async function fail(message) {
  await sendResult({ status: 'error', message });
  const state = await getState();
  if (state?.tabId != null) {
    await chrome.tabs.remove(state.tabId).catch(() => {});
  }
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
async function startLogin(deps, requestedPhase, reloginCount = 0) {
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
  const { id } = await chrome.tabs.create({ url: loginUrl });
  await setState({
    tabId: id,
    phase,
    deadline: Date.now() + PHASE_TIMEOUT_MS,
    reloginCount,
  });
  await chrome.alarms.create(ALARM_KEY, { when: Date.now() + PHASE_TIMEOUT_MS });
  await chrome.alarms.create(POLL_KEY, { periodInMinutes: POLL_PERIOD_MIN }).catch(() => {});
}

let isProcessing = false;

/** One processing pass after a cookie change or timer. */
async function processCookies() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const state = await getState();
    if (!state) return;
    const cookies = await chrome.cookies.getAll({});
    const action = nextAction(state, cookies);

    if (action === 'open-kulon') {
      // SSO done — navigate the SAME tab to the Kulon ticket (SSO-propagates to
      // Kulon, Mirrors the CDP flow). Microsoft OIDC may still require a sign-in.
      await chrome.tabs.update(state.tabId, { url: buildKulonTicketUrl() });
      await setState({ ...state, phase: 'kulon', deadline: Date.now() + PHASE_TIMEOUT_MS });
      return;
    }

    if (action === 'open-siap') {
      // Kulon done — navigate the SAME tab to SIAP (Microsoft session already
      // exists, so it auto-logs-in).
      await chrome.tabs.update(state.tabId, { url: buildSiapTicketUrl() });
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
        const url =
          step.phase === 'sso'
            ? deps().ssoLoginUrl
            : step.phase === 'kulon'
              ? deps().kulonLoginUrl
              : deps().siapLoginUrl;
        await chrome.tabs.update(state.tabId, { url });
        await setState({ ...state, phase: step.phase, deadline: Date.now() + PHASE_TIMEOUT_MS });
        return;
      }
      // The backend rejected the Kulon session as stale (e.g. it expired before
      // the handoff, or a pre-auth cookie set during the Microsoft OIDC redirect
      // was captured while the session was not yet live). Re-establish from the
      // central Kazan SSO session — Kulon and SIAP then re-follow automatically
      // — instead of failing permanently.
      if (!result.ok && result.code === 'KULON_STALE' && (state.reloginCount ?? 0) < RELOGIN_MAX) {
        if (state.tabId != null) {
          await chrome.tabs.remove(state.tabId).catch(() => {});
        }
        await startLogin(deps(), 'sso', (state.reloginCount ?? 0) + 1);
        await sendResult({ status: 'started', relogin: true });
        return;
      }
      await sendResult(
        step.action === 'ok'
          ? { status: 'ok', accessToken: result.accessToken }
          : { status: 'error', message: result.message },
      );
      if (state.tabId != null) {
        await chrome.tabs.remove(state.tabId).catch(() => {});
      }
      await chrome.alarms.clear(ALARM_KEY);
      await chrome.alarms.clear(POLL_KEY);
      await clearState();
      return;
    }

    // action === 'wait' → nothing to do; the cookies.onChanged listener or the
    // alarm will drive the next pass.
  } finally {
    isProcessing = false;
  }
}

// --- Message from the SPA (externally_connectable) ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleHandoffMessage(message, deps())
    .then((res) => {
      if (res.status === 'started' || res.status === 'relogin') {
        // Begin (or re-begin) the orchestrated flow: open a login tab for the
        // missing service and arm the per-service deadline. 'relogin' means the
        // captured session went stale — `res.phase` already resolves whether to
        // restart from SSO or (if SSO is still live) re-open the stale service
        // directly. 'started' also carries which service is missing in `res.phase`.
        startLogin(deps(), res.phase)
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
