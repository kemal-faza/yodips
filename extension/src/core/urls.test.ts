import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateTicket, buildKulonTicketUrl, buildSiapTicketUrl, DEFAULT_SERVER_URL } from './urls.js';

describe('DEFAULT_SERVER_URL', () => {
  it('menunjuk backend produksi — default localhost membuat install CWS baru gagal fetch', () => {
    expect(DEFAULT_SERVER_URL).toBe('https://backend.crunchy.my.id');
  });
});

/** Node-compatible atob for the vitest (node) environment. */
function atobNode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Node-compatible btoa (base64 of utf8) for the vitest (node) environment. */
function btoaNode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

describe('generateTicket', () => {
  it('returns base64 of the current unix second (backend-compatible)', () => {
    const before = Math.floor(Date.now() / 1000);
    const ticket = generateTicket();
    const after = Math.floor(Date.now() / 1000);
    const decoded = atobNode(ticket.trim());
    const n = Number(decoded);
    expect(n).toBeGreaterThanOrEqual(before);
    expect(n).toBeLessThanOrEqual(after + 1);
  });

  it('is base64(decimal unix seconds) for a fixed clock', () => {
    // Pinned so drift vs web/mobile/backend breaks THIS test:
    // btoa("1756000000") === "MTc1NjAwMDAwMA==".
    expect(generateTicket(1_756_000_000)).toBe(btoaNode('1756000000'));
    expect(generateTicket(1_756_000_000)).toBe('MTc1NjAwMDAwMA==');
  });

  it('agrees with the canonical ssoTicket.algorithm', () => {
    // The canonical JSON is the single source; assert the declared algorithm
    // and this implementation are the same at a fixed instant.
    const { ssoTicket } = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../contract/backend-contract.json'),
        'utf8',
      ),
    ) as { ssoTicket: { algorithm: string } };
    expect(ssoTicket.algorithm).toBe('base64(decimal unix seconds)');
    expect(generateTicket(1_756_000_000)).toBe(btoaNode('1756000000'));
  });
});

describe('ticket URLs', () => {
  it('buildKulonTicketUrl appends t to the prod OIDC URL', () => {
    expect(buildKulonTicketUrl()).toMatch(/^https:\/\/kulon2\.undip\.ac\.id\/auth\/oidc\/\?t=[A-Za-z0-9+/=]+$/);
  });
  it('buildSiapTicketUrl appends t to the prod SSO URL', () => {
    expect(buildSiapTicketUrl()).toMatch(/^https:\/\/siap\.undip\.ac\.id\/sso\/login\?t=[A-Za-z0-9+/=]+$/);
  });
});