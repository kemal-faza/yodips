/**
 * Transport probe Kulon. Semua I/O lewat fetchImpl yang di-inject.
 * Cookie dan token tidak pernah dipantulkan ke nilai balik yang dilaporkan.
 */
import type { BatchEntry } from './kulon-ws-shape';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const KULON_BASE_URL = 'https://kulon2.undip.ac.id';
export const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface HttpResult {
  status: number;
  url: string;
  text: string;
  body: unknown;
}

export async function fetchSesskey(
  fetchImpl: FetchLike,
  cookie: string,
): Promise<{ ok: true; sesskey: string; html: string } | { ok: false; reason: string }> {
  const response = await fetchImpl(KULON_BASE_URL + '/my/', { headers: { Cookie: cookie }, redirect: 'follow' });
  const html = await response.text();
  if (response.url.includes('/login/')) return { ok: false, reason: 'redirect-ke-login' };
  const match = html.match(/name="sesskey"\s+value="([^"]+)"/);
  if (match === null) return { ok: false, reason: 'sesskey-tidak-ditemukan' };
  return { ok: true, sesskey: match[1], html };
}

export async function ajaxBatch(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  entries: BatchEntry[],
): Promise<HttpResult> {
  const response = await fetchImpl(
    KULON_BASE_URL + '/lib/ajax/service.php?sesskey=' + encodeURIComponent(sesskey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(entries),
    },
  );
  if (response.status === 429) {
    throw new Error('rate limited (429): probe berhenti, coba lagi nanti');
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, url: response.url, text, body };
}

export async function fetchHtmlPage(
  fetchImpl: FetchLike,
  cookie: string,
  path: string,
): Promise<{ status: number; html: string }> {
  const response = await fetchImpl(KULON_BASE_URL + path, { headers: { Cookie: cookie }, redirect: 'follow' });
  return { status: response.status, html: await response.text() };
}

export async function restCall(
  fetchImpl: FetchLike,
  token: string,
  wsfunction: string,
  args: Record<string, unknown>,
): Promise<HttpResult> {
  const query = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json' });
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => body.append(key + '[' + index + ']', String(item)));
    } else {
      body.append(key, String(value));
    }
  }
  const response = await fetchImpl(KULON_BASE_URL + '/webservice/rest/server.php?' + query.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, url: response.url, text, body: parsed };
}

export type TokenFailReason = 'tanpa-location' | 'scheme-asing' | 'payload-bukan-bagian-2-3';

export type TokenShape =
  | { shape: 'ok'; parts: number; tokenLen: number; token: string }
  | { shape: 'fail'; status: number; reason: TokenFailReason };

export async function launchToken(
  fetchImpl: FetchLike,
  cookie: string,
  passport: string,
  scheme: string,
): Promise<TokenShape> {
  const url =
    KULON_BASE_URL +
    '/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=' +
    encodeURIComponent(passport) +
    '&urlscheme=' +
    encodeURIComponent(scheme);
  const response = await fetchImpl(url, {
    headers: { Cookie: cookie, 'User-Agent': DESKTOP_UA },
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (location === null) {
    return { shape: 'fail', status: response.status, reason: 'tanpa-location' };
  }
  const prefix = scheme + '://token=';
  if (!location.startsWith(prefix)) {
    // Location mentah tidak pernah disimpan: skemanya bisa berbeda dan tetap memuat token.
    return { shape: 'fail', status: response.status, reason: 'scheme-asing' };
  }
  const decoded = Buffer.from(location.slice(prefix.length), 'base64').toString('utf8');
  const parts = decoded.split(':::');
  if (parts.length !== 2 && parts.length !== 3) {
    return { shape: 'fail', status: response.status, reason: 'payload-bukan-bagian-2-3' };
  }
  return { shape: 'ok', parts: parts.length, tokenLen: parts[1].length, token: parts[1] };
}

export function publicTokenShape(shape: TokenShape): Record<string, unknown> {
  if (shape.shape === 'ok') return { shape: 'ok', parts: shape.parts, tokenLen: shape.tokenLen };
  return { shape: 'fail', status: shape.status, reason: shape.reason };
}

export function randomPassport(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
