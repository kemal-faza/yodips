#!/usr/bin/env node
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const EXT_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_PORT = 9222;
const DEBOUNCE_MS = 250;

export function findSwTarget(list, extId) {
  return list.find(
    (t) =>
      t.type === 'service_worker' &&
      t.url &&
      t.url.startsWith('chrome-extension://') &&
      t.url.endsWith('background.js') &&
      (!extId || t.url.includes(extId)),
  );
}

export async function reloadSw(wsUrl) {
  return new Promise((resolve) => {
    let ws;
    const done = (v) => { try { ws?.close(); } catch {} resolve(v); };
    try { ws = new WebSocket(wsUrl); } catch { return done(false); }
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.reload()' } }));
      } catch { done(false); }
    };
    ws.onmessage = (e) => { try { if (JSON.parse(e.data).id === 1) done(true); } catch {} };
    ws.onerror = () => done(false);
    setTimeout(() => done(false), 3000);
  });
}

async function getTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function runPackPopup() {
  return new Promise((resolve) => {
    const c = spawn('node', ['scripts/pack-popup.mjs'], { cwd: EXT_ROOT, stdio: 'ignore' });
    c.on('exit', () => resolve());
  });
}

const isMain = process.argv[1] && import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : DEFAULT_PORT);
  const vite = spawn('npx', ['vite', 'build', '--watch'], { cwd: EXT_ROOT, stdio: 'inherit' });

  let timer = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await runPackPopup();
      const targets = await getTargets(port);
      const sw = findSwTarget(targets);
      if (!sw) {
        console.log('[watch-reload] extension SW belum ditemukan — menunggu...');
        return;
      }
      const ok = await reloadSw(sw.webSocketDebuggerUrl);
      console.log(ok ? '[watch-reload] extension reloaded' : '[watch-reload] reload gagal/skip');
    }, DEBOUNCE_MS);
  };
  try {
    watch(path.join(EXT_ROOT, 'dist'), { recursive: true }, onChange);
  } catch {
    console.error('[watch-reload] Tidak bisa watch dist/ — pastikan npm run build sudah dijalankan sekali.');
  }
  console.log('[watch-reload] watching dist/ ...');
}