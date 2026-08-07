// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';
export const SIAP_SSO_URL = 'https://siap.undip.ac.id/sso/login';
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 25000;

/**
 * Generate a SSO ticket compatible with the backend's SSOTicketService:
 * base64 of the current unix second timestamp.
 *
 * Uses `btoa` (not Node `Buffer`) because MV3 service workers run in the
 * browser, where Buffer is undefined. For the ASCII digit timestamp the
 * output is identical to `Buffer.from(...).toString('base64')`.
 */
export function generateTicket() {
  return btoa(String(Math.floor(Date.now() / 1000)));
}

/** Build the Kulon OIDC service URL with a fresh ticket. */
export function buildKulonTicketUrl() {
  return `${KULON_OIDC_URL}?t=${generateTicket()}`;
}

/** Build the SIAP SSO service URL with a fresh ticket. */
export function buildSiapTicketUrl() {
  return `${SIAP_SSO_URL}?t=${generateTicket()}`;
}

export function cookiesToStr(cookies, pred) {
  return cookies
    .filter((c) => pred(c.domain))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

const hasKulon = (cookies) => !!cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id'));
const hasSiap = (cookies) => !!cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id'));

/**
 * Poll the cookie jar until `check(cookies)` is truthy or the timeout elapses.
 * Returns the last cookies array on success, or null on timeout. Uses deps.sleep
 * and deps.pollIntervalMs/pollTimeoutMs (defaults 3s/25s). Swappable to a
 * chrome.alarms-based wait later without changing the handoff contract.
 */
async function pollFor(deps, check) {
  const interval = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = deps.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  let cookies = await deps.getCookies();
  while (!check(cookies)) {
    if (Date.now() >= deadline) return null;
    await deps.sleep(interval);
    cookies = await deps.getCookies();
  }
  return cookies;
}

export async function handleHandoffMessage(message, deps) {
  if (message && message.action === 'ping') {
    return { status: 'ok' };
  }
  if (!message || message.action !== 'handoff') {
    return { status: 'error', message: 'Unknown action' };
  }
  const {
    getCookies,
    getServerUrl,
    fetchHandoff,
    openTab,
    kulonLoginUrl,
    siapLoginUrl,
  } = deps;

  // Kulon cookie is the hard requirement (it also derives identity). If it is
  // missing, direct the user to the Kulon OIDC login tab and poll until it
  // appears (or the window elapses).
  let cookies = await getCookies();
  if (!hasKulon(cookies)) {
    await openTab(kulonLoginUrl);
    const polled = await pollFor(deps, hasKulon);
    if (!polled) return { status: 'need-login', service: 'kulon' };
    cookies = polled;
  }

  // SIAP completes the session (complete = sso && kulon && siap). If only it is
  // missing, direct the user to the SIAP SSO login tab (auto-logs in because the
  // Microsoft session already exists) and poll until it appears.
  if (!hasSiap(cookies)) {
    await openTab(siapLoginUrl);
    const polled = await pollFor(deps, hasSiap);
    if (!polled) return { status: 'need-login', service: 'siap' };
    cookies = polled;
  }

  const kulonCookie = cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id'));
  const siapCookie = cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id'));
  const stored = (await getServerUrl()) || DEFAULT_SERVER_URL;
  const serverUrl = stored.replace(/\/+$/, '');
  const body = {
    kulonCookie,
    ssoCookie: cookiesToStr(cookies, (d) => d.includes('sso.undip.ac.id')),
    microsoftCookie: cookiesToStr(
      cookies,
      (d) => d.includes('microsoftonline.com') || d.includes('login.live.com'),
    ),
    siapCookie,
  };
  const res = await fetchHandoff(`${serverUrl}/api/auth/session/handoff`, body);
  if (!res.ok) {
    return { status: 'error', message: `Handoff gagal (${res.status})` };
  }
  return { status: 'ok', accessToken: res.accessToken };
}
