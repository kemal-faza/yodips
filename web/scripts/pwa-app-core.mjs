// Core pure generator PWA /app/ — tanpa dependency npm (stdlib only) agar
// bisa jalan di CI mana pun. CLI tipis ada di build-pwa-app.mjs.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, posix, sep } from 'node:path';

export const GZIP_GATE_BYTES = 7_500_000; // deviasi terukur #2: dist 6.74 MiB gzip per 2026-08-29 (markdown renderer 0.38.1). Next re-raise = split-chunk wajib, BUKAN reged lagi (see CHECKPOINT)

export async function collectFiles(distDir) {
  const out = [];
  async function walk(rel) {
    const entries = await readdir(join(distDir, rel), { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) await walk(relPath);
      else if (!e.name.endsWith('.map')) out.push({ rel: relPath, abs: join(distDir, relPath) });
    }
  }
  await walk('');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function cacheNameFor(urls) {
  const hash = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 16);
  return `yodips-app-${hash}`;
}

export function buildSwSource(entries) {
  const urls = entries.map((e) => e.url).sort();
  const cacheName = cacheNameFor(urls);
  // Kutip tunggal eksplisit (bukan JSON.stringify) — gaya SW idiomatik.
  const precacheList = urls.map((u) => `  '${u}',`).join('\n');
  return `// Auto-generated oleh scripts/build-pwa-app.mjs — JANGAN edit manual.
const CACHE_NAME = '${cacheName}';
const PRECACHE_MANIFEST = [
${precacheList}
];
const APP_FALLBACK = '/app/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE_MANIFEST)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/app/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(APP_FALLBACK).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});

// ---- IndexedDB helpers (SW tidak punya localStorage — lihat finding Task 6) ----
// DB 'sso_notif', store 'history' (keyPath 'id'). Records: {id:'list', items:[...]}
// (riwayat push, array StoredNotification) dan {id:'pendingNav', target} (navigasi tap).
function idbOpen() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open('sso_notif', 1);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbReadList(db) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction('history', 'readonly');
    const req = tx.objectStore('history').get('list');
    req.onsuccess = function () { const r = req.result; resolve(r && Array.isArray(r.items) ? r.items : []); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbWriteList(db, items) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').put({ id: 'list', items });
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
}
function idbWritePending(db, target) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').put({ id: 'pendingNav', target });
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
}
function idbNotifyClients(message) {
  if (!self.clients || !self.clients.matchAll) return Promise.resolve();
  return self.clients.matchAll({ type: 'window' }).then(function (cs) {
    for (const c of cs) { try { c.postMessage(message); } catch (e) { /* window ditutup */ } }
  });
}

// ---- Web Push (Task 6): riwayat IndexedDB + showNotification + postMessage ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Notifikasi', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Notifikasi';
  const body = data.body || '';
  const toast = {
    id: title + '|' + body,
    title,
    body,
    target: (data.data && data.data.target) || '',
    payload: JSON.stringify(data.data || {}),
    receivedAt: Date.now(),
  };
  event.waitUntil((async () => {
    try {
      const db = await idbOpen();
      const list = await idbReadList(db);
      list.unshift(toast);
      // Merge policy sama seperti sebelumnya: prepend terbaru, dedup id, cap 100.
      const dedup = []; const seen = {};
      for (const n of list) { if (!seen[n.id]) { seen[n.id] = 1; dedup.push(n); } }
      await idbWriteList(db, dedup.slice(0, 100));
      db.close();
    } catch (e) { /* IndexedDB gagal — tetap tampilkan notifikasi */ }
    await idbNotifyClients({ type: 'sso_push', toast });
    await self.registration.showNotification(title, { body, icon: '/app/favicon-192.png', badge: '/app/favicon-192.png', data: data.data || {} });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.target;
  const navTarget = target === 'schedule' ? 'schedule' : 'tasks';
  event.waitUntil((async () => {
    try {
      const db = await idbOpen();
      await idbWritePending(db, navTarget);
      db.close();
    } catch (e) { /* IndexedDB gagal — navigasi live tetap mungkin */ }
    if (self.clients && self.clients.matchAll) {
      const list = await self.clients.matchAll({ type: 'window' });
      let focused = false;
      for (const c of list) {
        try { c.postMessage({ type: 'sso_nav', target: navTarget }); } catch (e) {}
        if (!focused && typeof c.focus === 'function') { try { c.focus(); } catch (e) {} focused = true; }
      }
      if (!focused && self.clients.openWindow) return self.clients.openWindow('/app/');
    }
  })());
});
`;
}

export function buildManifest(_opts) {
  return JSON.stringify(
    {
      name: 'YoDips',
      short_name: 'YoDips',
      description: 'Gabungkan tugas, materi, dan notifikasi dari layanan akademik Undip.',
      theme_color: '#01637E',
      background_color: '#F7F7F7',
      display: 'standalone',
      start_url: '/app/',
      scope: '/app/',
      icons: [
        { src: '/app/favicon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/app/yodips-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/app/yodips-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n';
}

export async function gzipTotalBytes(files) {
  let total = 0;
  for (const f of files) total += gzipSync(await readFile(f.abs)).length;
  return total;
}

/**
 * Fail the /app/ build if the assembled index.html still contains inline
 * <script> bodies, inline event handlers, or external scripts whose src uses a
 * scheme the /app/* CSP would block (data:/blob:/javascript:). The /app/* CSP
 * (web/vercel.json) drops script-src 'unsafe-inline' and allows only 'self'
 * ('wasm-unsafe-eval' covers the fetched .wasm binaries); any inline script or
 * blocked-scheme src would be silently blocked and the PWA would ship a dead
 * page, so we fail at build time instead.
 *
 * A <script> with a src= attribute is fine only when it points at a same-origin
 * classic script (relative, '/app/...', or https://sso.crunchy.my.id/... — the
 * app's own origin). data:/blob:/javascript: srcs are NOT inline in the "no
 * body" sense, but they are executable under a permissive CSP and dead under
 * ours — either way they must never ship. <style> blocks stay fine
 * (style-src 'unsafe-inline' is retained for Compose-wasm).
 */
export function assertNoInlineScript(html) {
  const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i;
  const inlineHandler = /\son[a-z]+\s*=/i;
  if (inlineScript.test(html)) {
    throw new Error('FATAL: /app/index.html contains an inline <script> body. Move it to an external loader.js — CSP script-src for /app/* has no unsafe-inline.');
  }
  if (inlineHandler.test(html)) {
    throw new Error('FATAL: /app/index.html contains an inline event handler (on*="..."). Remove it — CSP for /app/* blocks inline handlers.');
  }
  // External <script src> is allowed only for same-origin classic scripts.
  // Reject scripts whose src is (or resolves to) an executable data:/blob:/
  // javascript: URL. Attribute value may be single/double/unquoted, with
  // whitespace around '='; scheme matching is case-insensitive.
  const SRC_ATTR = "\\bsrc\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))";
  const scheme = new RegExp(`^\\s*(data|blob|javascript)\\s*:`, 'i');
  const badSrc = new RegExp(`<script[^>]*\\b${SRC_ATTR}[^>]*>`, 'gi');
  let m;
  while ((m = badSrc.exec(html)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    if (scheme.test(value)) {
      throw new Error('FATAL: /app/index.html contains a <script src> with an executable data:/blob:/javascript: scheme, which /app/* CSP would block. Use a same-origin external script.');
    }
  }
}
