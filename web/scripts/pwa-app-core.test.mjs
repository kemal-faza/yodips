import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectFiles,
  buildSwSource,
  buildManifest,
  gzipTotalBytes,
  assertNoInlineScript,
  GZIP_GATE_BYTES,
} from './pwa-app-core.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pwa-core-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('assertNoInlineScript', () => {
  it('passes on clean external-script HTML with inline styles', () => {
    expect(() =>
      assertNoInlineScript('<script src="composeApp.js"></script><script src="loader.js"></script><style>.a{}</style>'),
    ).not.toThrow();
  });

  it('throws on an inline <script> body (no src)', () => {
    expect(() => assertNoInlineScript('<script>var x = 1;</script>')).toThrow(/inline <script> body/);
  });

  it('throws on an inline event handler', () => {
    expect(() => assertNoInlineScript('<div onclick="doEvil()">x</div>')).toThrow(/inline event handler/);
  });

  // A <script src> is only acceptable when it loads a same-origin classic
  // script. CSP-executable schemes (data:/blob:/javascript:) are blocked by
  // script-src 'self' but would otherwise let executable code ride in via a
  // "non-inline" looking tag — fail loudly. Variants: case, extra
  // whitespace/newlines around the equals, and single/double quoting.
  const scriptSchemeFixtures = [
    '<script src="data:text/javascript,evil()"></script>',
    "<script src='data:text/javascript,evil()'></script>",
    '<script src = "data:text/javascript,evil()"></script>',
    '<script\n  src="data:text/javascript,evil()">\n</script>',
    '<script src="DATA:TEXT/JAVASCRIPT,evil()"></script>',
    '<script src="data:text/html,<script>evil()</script>"></script>',
    '<script src="blob:https://sso.crunchy.my.id/abc-123"></script>',
    '<script src="BLOB:https://sso.crunchy.my.id/abc-123"></script>',
    '<script src = \'blob:https://sso.crunchy.my.id/abc-123\'></script>',
    '<script src="javascript:evil()"></script>',
    '<script src="JaVaScRiPt:evil()"></script>',
    '<script src=javascript:evil()></script>',
  ];
  it.each(scriptSchemeFixtures)('throws on CSP-blocked script src scheme: %s', (html) => {
    // A src-scheme violation throws its own message; a src-less inline body
    // would throw the inline-body message. Either is a loud failure — assert
    // the shared FATAL prefix so the test stays meaningful for both.
    expect(() => assertNoInlineScript(html)).toThrow(/^FATAL: \/app\/index\.html contains/);
  });

  // Schemes that are NOT executable script sources under CSP must stay allowed.
  const harmlessSrcFixtures = [
    '<script src="composeApp.js"></script>',
    '<script src="loader.js"></script>',
    '<script src="/app/composeApp.js"></script>',
    '<script src="https://sso.crunchy.my.id/app/composeApp.js"></script>',
    '<script src="app.js?ver=1&x=2"></script>',
    '<script type="module" src="main.mjs"></script>',
  ];
  it.each(harmlessSrcFixtures)('allows same-origin external script src: %s', (html) => {
    expect(() => assertNoInlineScript(html)).not.toThrow();
  });
});

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

  it('SW memuat handler push + notificationclick + IndexedDB (tanpa localStorage)', () => {
    const src = buildSwSource([{ url: '/app/a.js' }]);
    expect(src).toContain("self.addEventListener('push'");
    expect(src).toContain("self.addEventListener('notificationclick'");
    expect(src).toContain("indexedDB.open('sso_notif'");
    expect(src).toContain("createObjectStore('history'");
    expect(src).toContain("idbNotifyClients({ type: 'sso_push', toast })");
    expect(src).toContain("c.postMessage({ type: 'sso_nav', target: navTarget })");
    expect(src).toContain("self.registration.showNotification");
    expect(src).toContain("openWindow('/app/')");
    // SW tidak punya Web Storage — harus bebas dari pemakaian self.localStorage.
    expect(src).not.toContain('self.localStorage');
    expect(src).not.toContain('sso_notif_history');
    expect(src).not.toContain('sso_pending_nav');
    // Source harus valid JS (parse-able via Function constructor).
    expect(() => new Function(src)).not.toThrow();
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
  it('menjumlahkan gzip dan konstanta gate = 7.5 MB (deviasi terukur #2)', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(1000)); // teks repetitif → gzip kecil
    const total = await gzipTotalBytes([{ abs: join(dir, 'a.txt') }]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1000);
    expect(GZIP_GATE_BYTES).toBe(7_500_000);
  });
});
