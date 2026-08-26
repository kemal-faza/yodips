// Default untuk install baru (CWS): HARUS prod. Dev menimpa lewat popup
// (chrome.storage.sync) — default localhost membuat pengguna nyata gagal
// fetch tanpa penjelasan (insiden 2026-08-26).
export const DEFAULT_SERVER_URL = 'https://backend.crunchy.my.id';
export const SSO_LOGIN_URL = 'https://sso.undip.ac.id/auth/user/login';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';
export const SIAP_SSO_URL = 'https://siap.undip.ac.id/sso/login';

/** base64 of the current unix second, matching backend SSOTicketService.
 *  Uses `btoa` (not Buffer) because MV3 service workers run in the browser. */
export function generateTicket(): string {
  return btoa(String(Math.floor(Date.now() / 1000)));
}

export function buildKulonTicketUrl(): string {
  return `${KULON_OIDC_URL}?t=${generateTicket()}`;
}

export function buildSiapTicketUrl(): string {
  return `${SIAP_SSO_URL}?t=${generateTicket()}`;
}