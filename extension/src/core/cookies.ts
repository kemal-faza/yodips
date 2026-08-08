import type { CookieFlags, Service } from './contract.js';

export const SSO_SESSION_COOKIE = 'ci_session_sso';
export const SIAP_SESSION_COOKIE_RE = /^(?:sia_|sipp|siapp|ciapp_)/i;
export const PHASE_CHAIN: Service[] = ['sso', 'kulon', 'siap'];

export interface CookieP {
  name: string | RegExp;
  domain: string;
}

export function cookiePatternsForPhase(phase: Service): CookieP[] {
  if (phase === 'sso') {
    return [
      { domain: 'sso.undip.ac.id', name: SSO_SESSION_COOKIE },
      { domain: 'undip.ac.id', name: SSO_SESSION_COOKIE },
    ];
  }
  if (phase === 'kulon') {
    return [{ domain: 'kulon2.undip.ac.id', name: /^MoodleSession/ }];
  }
  // 'siap'
  return [
    { domain: 'siap.undip.ac.id', name: SIAP_SESSION_COOKIE_RE },
    { domain: 'undip.ac.id', name: SIAP_SESSION_COOKIE_RE },
  ];
}

export function phasesToClear(phase: Service): Service[] {
  const idx = PHASE_CHAIN.indexOf(phase);
  return idx === -1 ? [] : PHASE_CHAIN.slice(idx);
}

function isUndipParent(d: string): boolean {
  return d === 'undip.ac.id' || d.endsWith('.undip.ac.id');
}

/** True only for a SIAP *session* cookie (name-precise). The bare domain is
 *  NOT enough: siap.undip.ac.id also carries `cookiesession1` — an F5
 *  load-balancer/sticky cookie set on ANY page load — which must never be
 *  read as evidence of a logged-in SIAP session (it caused an endless
 *  KULON_STALE loop: hasSiap stayed true pre-login). */
function isSiapCookie(c: { name: string; domain: string }): boolean {
  return (c.domain.includes('siap.undip.ac.id') || isUndipParent(c.domain)) && SIAP_SESSION_COOKIE_RE.test(c.name);
}

export interface CookieLite {
  name: string;
  domain: string;
  value?: string;
}

export function evaluateCookies(cookies: CookieLite[]): CookieFlags {
  return {
    hasSso: cookies.some(
      (c) =>
        c.name === SSO_SESSION_COOKIE &&
        (c.domain.includes('sso.undip.ac.id') || isUndipParent(c.domain)),
    ),
    hasKulon: cookies.some(
      (c) => c.domain.includes('kulon2.undip.ac.id') && /^MoodleSession/.test(c.name),
    ),
    hasSiap: cookies.some(isSiapCookie),
  };
}

export function cookiesToStr<T extends CookieLite>(
  cookies: T[],
  pred: (cookie: T) => boolean,
): string {
  return cookies
    .filter(pred)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function buildHandoffBody(cookies: CookieLite[]) {
  return {
    kulonCookie: cookiesToStr(cookies, (c) => c.domain.includes('kulon2.undip.ac.id')),
    ssoCookie: cookiesToStr(
      cookies,
      (c) =>
        c.domain.includes('sso.undip.ac.id') ||
        (isUndipParent(c.domain) && c.name === SSO_SESSION_COOKIE),
    ),
    microsoftCookie: cookiesToStr(
      cookies,
      (c) => c.domain.includes('microsoftonline.com') || c.domain.includes('login.live.com'),
    ),
    siapCookie: cookiesToStr(cookies, isSiapCookie),
  };
}