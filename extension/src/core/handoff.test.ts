import { describe, it, expect } from 'vitest';
import { interpretHandoff, summarizeHandoff } from './handoff.js';

describe('interpretHandoff', () => {
  it('ok when all three verified', () => {
    const d = interpretHandoff({ ok: true, status: 200, accessToken: 'jwt', hasSso: true, hasKulon: true, hasSiap: true });
    expect(d).toEqual({ action: 'ok', token: 'jwt' });
  });
  it('needsService picks first missing service in order', () => {
    expect(interpretHandoff({ ok: true, status: 200, accessToken: 'jwt', hasSso: false, hasKulon: true, hasSiap: true }))
      .toEqual({ action: 'needsService', service: 'sso' });
    expect(interpretHandoff({ ok: true, status: 200, accessToken: 'jwt', hasSso: true, hasKulon: false, hasSiap: true }))
      .toEqual({ action: 'needsService', service: 'kulon' });
    expect(interpretHandoff({ ok: true, status: 200, accessToken: 'jwt', hasSso: true, hasKulon: true, hasSiap: false }))
      .toEqual({ action: 'needsService', service: 'siap' });
  });
  it('stale on KULON_STALE code', () => {
    expect(interpretHandoff({ ok: false, status: 400, code: 'KULON_STALE' })).toEqual({ action: 'stale' });
  });
  it('error otherwise', () => {
    expect(interpretHandoff({ ok: false, status: 500, message: 'boom' })).toEqual({ action: 'error', message: 'boom' });
  });
});

describe('summarizeHandoff', () => {
  it('returns non-secret diagnostics only', () => {
    const s = summarizeHandoff({ ok: true, status: 200, code: undefined, accessToken: 'jwt', hasSso: true, hasKulon: true, hasSiap: true });
    expect((s as Record<string, unknown>).accessToken).toBeUndefined();
    expect(s.hasSso).toBe(true);
  });
});