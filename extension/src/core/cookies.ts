import type { CookieFlags, Service } from './contract.js';

export const SSO_SESSION_COOKIE = 'ci_session_sso';
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
    { domain: 'siap.undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
    { domain: 'undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
  ];
}

export function phasesToClear(phase: Service): Service[] {
  const idx = PHASE_CHAIN.indexOf(phase);
  return idx === -1 ? [] : PHASE_CHAIN.slice(idx);
}

function isUndipParent(d: string): boolean {
  return d === 'undip.ac.id' || d.endsWith('.undip.ac.id');
}

/** A SIAP cookie: sessions usually live on siap.* but some deploy on the parent
 *  `.undip.ac.id` domain. On the parent, only name-precise matches count (so a
 *  bare `csrftoken` or the Kazan `ci_session_sso` cannot trip SIAP detection). */
function isSiapCookie(c: { name: string; domain: string }): boolean {
  if (c.domain.includes('siap.undip.ac.id')) return true;
  return isUndipParent(c.domain) && /^(?:sia_|siap|ciapp_)/i.test(c.name);
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