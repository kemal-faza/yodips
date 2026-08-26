import { describe, it, expect } from 'vitest';
import { generateTicket, buildKulonTicketUrl, buildSiapTicketUrl, KULON_OIDC_URL, SIAP_SSO_URL, DEFAULT_SERVER_URL } from './urls.js';

describe('DEFAULT_SERVER_URL', () => {
  it('menunjuk backend produksi — default localhost membuat install CWS baru gagal fetch', () => {
    expect(DEFAULT_SERVER_URL).toBe('https://backend.crunchy.my.id');
  });
});

/** Node-compatible atob for the vitest (node) environment. */
function atobNode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
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
});

describe('ticket URLs', () => {
  it('buildKulonTicketUrl appends t to OIDC URL', () => {
    expect(buildKulonTicketUrl()).toMatch(new RegExp(`^${KULON_OIDC_URL}\\?t=[A-Za-z0-9+/=]+$`));
  });
  it('buildSiapTicketUrl appends t to SSO URL', () => {
    expect(buildSiapTicketUrl()).toMatch(new RegExp(`^${SIAP_SSO_URL}\\?t=[A-Za-z0-9+/=]+$`));
  });
});