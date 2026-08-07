// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';

/**
 * Generate a SSO ticket compatible with the backend's SSOTicketService:
 * base64 of the current unix second timestamp.
 */
export function generateTicket() {
  return Buffer.from(String(Math.floor(Date.now() / 1000))).toString('base64');
}

/** Build the Kulon OIDC service URL with a fresh ticket. */
export function buildKulonTicketUrl() {
  return `${KULON_OIDC_URL}?t=${generateTicket()}`;
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
  const { getCookies, getServerUrl, fetchHandoff, openTab, ssologinUrl } = deps;

  const cookies = await getCookies();
  const kulonCookie = cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id'));
  if (!kulonCookie) {
    await openTab(ssologinUrl);
    return { status: 'need-login' };
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
    siapCookie: cookiesToStr(cookies, (d) => d.includes('siap.undip.ac.id')),
  };
  const res = await fetchHandoff(`${serverUrl}/api/auth/session/handoff`, body);
  if (!res.ok) {
    return { status: 'error', message: `Handoff gagal (${res.status})` };
  }
  return { status: 'ok', accessToken: res.accessToken };
}
