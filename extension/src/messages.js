// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';
export const SIAP_SSO_URL = 'https://siap.undip.ac.id/sso/login';

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

  const cookies = await getCookies();
  // Kulon cookie is the hard requirement (it also derives identity). If it is
  // missing, direct the user to the Kulon OIDC login tab and ask them to retry.
  const kulonCookie = cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id'));
  if (!kulonCookie) {
    await openTab(kulonLoginUrl);
    return { status: 'need-login', service: 'kulon' };
  }
  // SIAP completes the session (complete = sso && kulon && siap). If only it is
  // missing, direct the user to the SIAP SSO login tab (auto-logs in because the
  // Microsoft session already exists) and ask them to retry.
  const siapCookie = cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id'));
  if (!siapCookie) {
    await openTab(siapLoginUrl);
    return { status: 'need-login', service: 'siap' };
  }

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
