import { describe, it, expect } from 'vitest';
import { interpretHandoff, summarizeHandoff, networkFailureMessage } from './handoff.js';

describe('networkFailureMessage', () => {
  it('menyebut host tujuan + arahan ke Server URL popup (bukan "Failed to fetch" mentah)', () => {
    const msg = networkFailureMessage('http://localhost:3000/api/auth/session/handoff');
    expect(msg).toContain('localhost:3000');
    expect(msg).toContain('Server URL');
    expect(msg).not.toContain('Failed to fetch');
  });
  it('aman untuk URL tidak valid (fallback tanpa host)', () => {
    const msg = networkFailureMessage('bukan-url');
    expect(msg).toContain('Server URL');
  });
});

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
    expect(interpretHandoff({ ok: false, status: 400, code: 'KULON_STALE' })).toEqual({ action: 'stale', service: 'kulon' });
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