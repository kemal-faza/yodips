#!/usr/bin/env node
// Rakit PWA /app/: salin dist wasm → out, tambah manifest + sw.js, gate gzip.
// Pemakaian: node scripts/build-pwa-app.mjs --dist <wasmDist> --out <dir> [--web-public <dir>]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, buildSwSource, buildManifest, gzipTotalBytes, assertNoInlineScript, GZIP_GATE_BYTES } from './pwa-app-core.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? resolve(process.argv[i + 1]) : fallback;
}

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const dist = arg('dist');
const out = arg('out', resolve(webRoot, 'dist/app'));
const webPublic = arg('web-public', resolve(webRoot, 'public'));
if (!dist) { console.error('--dist wajib'); process.exit(2); }

mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true, filter: (s) => !s.endsWith('.map') });

// Gate inline script (CSP /app/* sudah tanpa 'unsafe-inline' — lihat vercel.json).
// index.html di dist berasal dari wasmJsMain/resources; inline <script> di sana
// akan senyap mati di produksi, jadi build GAGAL lebih dulu.
const indexHtml = readFileSync(resolve(out, 'index.html'), 'utf8');
assertNoInlineScript(indexHtml);
if (!process.argv.some((a) => a === '--no-loader-require') && !indexHtml.includes('loader.js')) {
  console.error('FATAL: /app/index.html tidak mereferensikan loader.js (FOUC guard inline-free).');
  process.exit(1);
}
if (!process.argv.some((a) => a === '--no-loader-file') && !existsSync(resolve(out, 'loader.js'))) {
  console.error('FATAL: loader.js tidak ikut tersalin ke output /app/.');
  process.exit(1);
}

for (const icon of ['favicon-192.png', 'yodips-logo-512.png']) {
  cpSync(resolve(webPublic, icon), resolve(out, icon));
}
writeFileSync(resolve(out, 'manifest.webmanifest'), buildManifest({}));

const files = await collectFiles(out);
writeFileSync(resolve(out, 'sw.js'), buildSwSource(files.map((f) => ({ url: '/app/' + f.rel.split(sep).join('/') }))));

const total = await gzipTotalBytes(files);
console.log(`PWA /app/: ${files.length} file, gzip total ${(total / 1048576).toFixed(2)} MB (gate ${GZIP_GATE_BYTES})`);
if (total > GZIP_GATE_BYTES) {
  console.error(`GERBANG GAGAL: gzip total melebihi ${GZIP_GATE_BYTES} byte`);
  process.exit(1);
}
