#!/usr/bin/env node
// Captures SSO/Microsoft/Kulon/SIAP session cookies from the user's running
// Chrome (via CDP) and POSTs them to the server's handoff endpoint.
// Usage:
//   node capture-handoff.mjs --api <serverUrl> --app-url <spaUrl> [--cdp http://127.0.0.1:9223] [--identity NIM]
import { chromium } from 'playwright-core';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    api: get('--api'),
    appUrl: get('--app-url'),
    cdp: get('--cdp') ?? 'http://127.0.0.1:9223',
    identity: get('--identity'),
  };
}

function cookieStr(cookies, pred) {
  return cookies
    .filter((c) => pred(c.domain))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

const opts = parseArgs();
if (!opts.api) {
  console.error(
    'Usage: node capture-handoff.mjs --api <serverUrl> --app-url <spaUrl> [--cdp http://127.0.0.1:9223] [--identity NIM]',
  );
  process.exit(2);
}

/**
 * Validate --app-url at CLI preflight (before CDP connect / handoff POST) so a
 * missing or malformed SPA URL never mints a server session/JWT that is then
 * discarded. Must be an absolute http(s) URL with NO credentials and NO
 * fragment: a fragment here would defeat the #access_token transport below,
 * and credentials would leak into the opener URL / logs.
 * Returns the normalized base URL (trailing slash stripped) or null.
 */
function validateAppUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null; // credentials
  if (u.hash) return null; // fragment
  return u.origin + u.pathname.replace(/\/+$/, '');
}

const appBaseUrl = validateAppUrl(opts.appUrl);
if (!appBaseUrl) {
  console.error(
    'Usage: node capture-handoff.mjs --api <serverUrl> --app-url <spaUrl> [--cdp http://127.0.0.1:9223] [--identity NIM]\n' +
      '--app-url WAJIB berupa URL absolut http:// atau https:// TANPA kredensial dan TANPA fragment ' +
      '(contoh: --app-url http://localhost:5173).\n' +
      'Token tidak akan pernah ditampilkan di terminal.',
  );
  process.exit(1);
}

const browser = await chromium.connectOverCDP(opts.cdp);
try {
  const context = browser.contexts()[0];
  if (!context) {
    console.error('Tidak ada browser context — jalankan Chrome dengan --remote-debugging-port dulu.');
    process.exit(1);
  }
  const cookies = await context.cookies();

  const body = {
    kulonCookie: cookieStr(cookies, (d) => d.includes('kulon2.undip.ac.id')),
    ssoCookie: cookieStr(cookies, (d) => d.includes('sso.undip.ac.id')),
    microsoftCookie: cookieStr(cookies, (d) => d.includes('microsoftonline.com') || d.includes('login.live.com')),
    siapCookie: cookieStr(cookies, (d) => d.includes('siap.undip.ac.id')),
    identity: opts.identity,
  };

  if (!body.kulonCookie) {
    console.error('ERROR: cookie Kulon tidak ditemukan — pastikan sudah login ke Kulon di browser ini.');
    process.exit(1);
  }

  const res = await fetch(`${opts.api.replace(/\/$/, '')}/api/auth/session/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Handoff gagal: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  // YD-AUTH-002: never put the bearer JWT in a server-visible URL (?query) and
  // never print it. The SPA accepts it ONLY via a URL #fragment, which browsers
  // never send in HTTP requests, and only when VITE_LOGIN_MODE=handoff (the
  // deprecated dev/test capture fallback). The SPA consumes the fragment once
  // and scrubs it from history synchronously (before any store write/await).
  const token = data.accessToken;
  if (!token) {
    console.error('Handoff sukses tapi tidak ada accessToken di respons.');
    process.exit(1);
  }
  // appBaseUrl was validated at preflight (http/https, no credentials, no
  // fragment) BEFORE the handoff POST, so this open path is unconditional —
  // there is intentionally no fallback here.
  const spaUrl = `${appBaseUrl}/login#access_token=${encodeURIComponent(token)}`;
  console.log('Session diterima server. Membuka SPA… (token dikirim via URL-fragment, bukan query/terminal)');
  const { spawn } = await import('node:child_process');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [spaUrl], { detached: true, stdio: 'ignore' }).unref();
} finally {
  await browser.close();
}
