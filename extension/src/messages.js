// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const SSO_LOGIN_URL = 'https://sso.undip.ac.id/';

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
