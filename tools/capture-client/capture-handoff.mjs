#!/usr/bin/env node
// Captures SSO/Microsoft/Kulon/SIAP session cookies from the user's running
// Chrome (via CDP) and POSTs them to the server's handoff endpoint.
// Usage:
//   node capture-handoff.mjs --api <serverUrl> [--app-url <spaUrl>] [--cdp http://127.0.0.1:9223] [--identity NIM]
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
    'Usage: node capture-handoff.mjs --api <serverUrl> [--app-url <spaUrl>] [--cdp http://127.0.0.1:9223] [--identity NIM]',
  );
  process.exit(2);
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
  console.log('Session diterima server. JWT diterbitkan.');

  if (opts.appUrl) {
    const tokenUrl = `${opts.appUrl.replace(/\/$/, '')}/login?token=${encodeURIComponent(data.accessToken)}`;
    console.log('Membuka SPA:', tokenUrl.slice(0, 80) + '…');
    const { spawn } = await import('node:child_process');
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [tokenUrl], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.log('Buka SPA manual: /login?token=' + data.accessToken);
  }
} finally {
  await browser.close();
}
