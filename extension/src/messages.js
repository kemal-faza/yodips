// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';
export const SIAP_SSO_URL = 'https://siap.undip.ac.id/sso/login';
export const POLL_INTERVAL_MS = 3000;
export const PHASE_TIMEOUT_MS = 3 * 60_000; // per-service login deadline (like CDP)

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

/**
 * Evaluate which required session cookies are present. SIAP cookies may be
 * stored on a parent `Domain=.undip.ac.id` — the substring match covers both
 * the exact host and any parent-domain form exposed via host_permissions.
 */
export function evaluateCookies(cookies) {
  return {
    hasKulon: !!cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id')),
    hasSiap: !!cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id')),
  };
}

/**
 * Decide the next orchestration step given the current phase and cookies.
 * - 'wait': keep waiting for the current service's cookie
 * - 'open-siap': kulon done, navigate the SAME tab to the SIAP login
 * - 'handoff': both cookies present, POST the handoff
 */
export function nextAction(state, cookies) {
  const { hasKulon, hasSiap } = evaluateCookies(cookies);
  if (state.phase === 'siap') {
    return hasSiap ? 'handoff' : 'wait';
  }
  // phase 'kulon'
  if (!hasKulon) return 'wait';
  return hasSiap ? 'handoff' : 'open-siap';
}

/** Build the HandoffDto body from the full cookie list. */
export function buildHandoffBody(cookies) {
  return {
    kulonCookie: cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id')),
    ssoCookie: cookiesToStr(cookies, (d) => d.includes('sso.undip.ac.id')),
    microsoftCookie: cookiesToStr(
      cookies,
      (d) => d.includes('microsoftonline.com') || d.includes('login.live.com'),
    ),
    siapCookie: cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id')),
  };
}

/** POST the cookies to the backend handoff endpoint. */
export async function performHandoff(deps, cookies) {
  const stored = (await deps.getServerUrl()) || DEFAULT_SERVER_URL;
  const serverUrl = stored.replace(/\/+$/, '');
  const res = await deps.fetchHandoff(`${serverUrl}/api/auth/session/handoff`, buildHandoffBody(cookies));
  if (!res.ok) {
    return { ok: false, status: res.status, message: `Handoff gagal (${res.status})` };
  }
  return { ok: true, accessToken: res.accessToken };
}

/**
 * Entry point for messages from the web app.
 * - 'ping'  → cheap liveness probe (no cookies touched)
 * - 'handoff' → if both cookies already present, complete immediately;
 *   otherwise return `{status:'started'}` and let the background orchestrator
 *   (tabs + cookies.onChanged + alarms) drive the rest.
 */
export async function handleHandoffMessage(message, deps) {
  if (message && message.action === 'ping') {
    return { status: 'ok' };
  }
  if (!message || message.action !== 'handoff') {
    return { status: 'error', message: 'Unknown action' };
  }
  const cookies = await deps.getCookies();
  const { hasKulon, hasSiap } = evaluateCookies(cookies);
  if (!hasKulon || !hasSiap) {
    return { status: 'started' };
  }
  const result = await performHandoff(deps, cookies);
  return { ...result, status: result.ok ? 'ok' : 'error' };
}
