// Core pure generator PWA /app/ — tanpa dependency npm (stdlib only) agar
// bisa jalan di CI mana pun. CLI tipis ada di build-pwa-app.mjs.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, posix, sep } from 'node:path';

export const GZIP_GATE_BYTES = 6_000_000; // deviasi terukur dari spec §10 (5MB): dist aktual 5.246.769 B gzip per 2026-08-26

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

// ---- Web Push (Task 6): simpan ke riwayat localStorage + tampilkan ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Notifikasi', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Notifikasi';
  const body = data.body || '';
  const id = title + '|' + body;
  const toast = { id, title, body, target: data.data?.target || '', payload: JSON.stringify(data.data || {}), receivedAt: Date.now() };
  const key = 'sso_notif_history';
  if (self.localStorage) {
    try {
      const raw = self.localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.unshift(toast);
      const dedup = []; const seen = {};
      for (const n of arr) { if (!seen[n.id]) { seen[n.id] = 1; dedup.push(n); } }
      self.localStorage.setItem(key, JSON.stringify(dedup.slice(0, 100)));
    } catch (e) { /* localStorage gagal — tetap tampilkan notifikasi */ }
  }
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/app/favicon-192.png', badge: '/app/favicon-192.png', data: data.data || {} }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.target;
  try {
    if (self.localStorage) self.localStorage.setItem('sso_pending_nav', (target === 'schedule' ? 'schedule' : 'tasks'));
  } catch (e) {}
  event.waitUntil(clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/app/');
  }));
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
