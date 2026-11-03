import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Policy guard for the SPA service worker (scope "/"). A root-scope SW that
// falls back every navigation to the SPA shell also captures /app/ and serves
// the SPA there — the PWA never loads and its own SW never registers. The
// denylist must therefore exclude the PWA prefix. This is a static check
// because the Workbox option only materializes in the generated dist/sw.js,
// which does not exist during `npm test`.
// `npm test` runs from web/ (the package root); keep this cwd-relative so the
// check does not depend on Vitest's module URL scheme.
const config = readFileSync('vite.config.ts', 'utf8');

describe('SPA service worker navigation fallback', () => {
  it('keeps /api/ and /app/ out of the SPA shell fallback', () => {
    expect(config).toContain('navigateFallbackDenylist: [/^\\/api\\//, /^\\/app(\\/|$)/]');
  });
});
