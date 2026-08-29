import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectFiles,
  buildSwSource,
  buildManifest,
  gzipTotalBytes,
  GZIP_GATE_BYTES,
} from './pwa-app-core.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pwa-core-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('collectFiles', () => {
  it('rekursif, rel posix, dan membuang sourcemap', async () => {
    mkdirSync(join(dir, 'composeResources', 'font'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), 'x');
    writeFileSync(join(dir, 'composeApp.js'), 'y');
    writeFileSync(join(dir, 'composeApp.js.map'), 'z');
    writeFileSync(join(dir, 'composeResources', 'font', 'geist.bin'), 'w');
    const files = await collectFiles(dir);
    expect(files.map((f) => f.rel).sort()).toEqual(
      ['composeApp.js', 'composeResources/font/geist.bin', 'index.html'],
    );
  });
});

describe('buildSwSource', () => {
  it('memuat semua url, cache-name stabil deterministik, fallback navigasi /app/index.html', () => {
    const src1 = buildSwSource([{ url: '/app/a.js' }, { url: '/app/b.wasm' }]);
    const src2 = buildSwSource([{ url: '/app/b.wasm' }, { url: '/app/a.js' }]);
    expect(src1).toContain("'/app/a.js'");
    expect(src1).toContain("'/app/b.wasm'");
    expect(src1).toMatch(/CACHE_NAME = 'yodips-app-[0-9a-f]{16}'/);
    expect(src1).toBe(src2); // urutan input tak mengubah hasil
    expect(src1).toContain('/app/index.html');
    // cache-name berubah bila daftar aset berubah → invalidasi otomatis
    expect(buildSwSource([{ url: '/app/c.js' }])).not.toBe(src1);
  });

  it('SW memuat handler push + notificationclick + riwayat localStorage', () => {
    const src = buildSwSource([{ url: '/app/a.js' }]);
    expect(src).toContain("self.addEventListener('push'");
    expect(src).toContain("self.addEventListener('notificationclick'");
    expect(src).toContain("'sso_notif_history'");
    expect(src).toContain("'sso_pending_nav'");
    expect(src).toContain('self.registration.showNotification');
    // UI js berisi backtick/${} akan merusak template literal — SW source harus aman.
    expect(src).not.toContain('${');
  });
});

describe('buildManifest', () => {
  it('start_url & scope /app/, ikon absolut, JSON valid', () => {
    const m = JSON.parse(buildManifest({}));
    expect(m.start_url).toBe('/app/');
    expect(m.scope).toBe('/app/');
    expect(m.display).toBe('standalone');
    expect(m.icons.some((i) => i.src === '/app/yodips-logo-512.png' && i.purpose === 'maskable')).toBe(true);
  });
});

describe('gzipTotalBytes', () => {
  it('menjumlahkan gzip dan konstanta gate = 6 MB', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(1000)); // teks repetitif → gzip kecil
    const total = await gzipTotalBytes([{ abs: join(dir, 'a.txt') }]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1000);
    expect(GZIP_GATE_BYTES).toBe(6_000_000);
  });
});
