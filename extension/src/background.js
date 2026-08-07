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
  evaluateCookies,
  DEFAULT_SERVER_URL,
  buildKulonTicketUrl,
  buildSiapTicketUrl,
  PHASE_TIMEOUT_MS,
} from './messages.js';

const STORAGE_KEY = 'serverUrl';
const STATE_KEY = 'ssoLoginState';
const ALARM_KEY = 'handoff-timeout';

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
  await clearState();
}

/** One processing pass after a cookie change or timer. */
async function processCookies() {
  const state = await getState();
  if (!state) return;
  const cookies = await chrome.cookies.getAll({});
  const action = nextAction(state, cookies);

  if (action === 'open-siap') {
    // Kulon done — navigate the SAME tab to SIAP (Microsoft session already
    // exists, so it auto-logs-in).
    await chrome.tabs.update(state.tabId, { url: buildSiapTicketUrl() });
    await setState({ ...state, phase: 'siap', deadline: Date.now() + PHASE_TIMEOUT_MS });
    return;
  }

  if (action === 'handoff') {
    const result = await performHandoff(deps(), cookies);
    await sendResult(
      result.ok
        ? { status: 'ok', accessToken: result.accessToken }
        : { status: 'error', message: result.message },
    );
    if (state.tabId != null) {
      await chrome.tabs.remove(state.tabId).catch(() => {});
    }
    await chrome.alarms.clear(ALARM_KEY);
    await clearState();
    return;
  }

  // action === 'wait' → nothing to do; the cookies.onChanged listener or the
  // alarm will drive the next pass.
}

// --- Message from the SPA (externally_connectable) ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleHandoffMessage(message, deps())
    .then((res) => {
      if (res.status === 'started') {
        // Begin the orchestrated flow: open the first missing service tab and
        // arm the per-service deadline.
        const statePromise = (async () => {
          const cookies = await chrome.cookies.getAll({});
          const { hasKulon, hasSiap } = evaluateCookies(cookies);
          const phase = hasKulon ? 'siap' : 'kulon';
          const loginUrl = phase === 'kulon' ? buildKulonTicketUrl() : buildSiapTicketUrl();
          const { id } = await chrome.tabs.create({ url: loginUrl });
          await setState({ tabId: id, phase, deadline: Date.now() + PHASE_TIMEOUT_MS });
          await chrome.alarms.create(ALARM_KEY, {
            when: Date.now() + PHASE_TIMEOUT_MS,
          });
          return { status: 'started' };
        })();
        statePromise.then(sendResponse).catch((err) =>
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
  if (alarm.name !== ALARM_KEY) return;
  fail('Login belum selesai dalam batas waktu. Silakan klik "Login via Extension" lagi.').catch(
    () => {},
  );
});
