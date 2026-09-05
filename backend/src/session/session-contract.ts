import { randomBytes } from 'crypto';

/**
 * Dependency-neutral session contract — the ONE place every module (auth,
 * session stores, guards, upstream seams, pairing) reads the captured-session
 * shape and generation helpers from.
 *
 * HISTORY: these types/helpers used to live in
 * `playwright/playwright-auth.service.ts`, which imports KulonService +
 * SiapService. `session/session-store.ts` importing them back created a
 * FILE-LEVEL circular dependency (session-store → playwright-auth.service →
 * kulon.service/siap.service → session-store). Under the built CommonJS
 * bundle, the cycle left emitted constructor metadata for `SessionStore`
 * undefined in KulonService, KulonUpstreamSession and SiapUpstreamSession —
 * consumers captured an empty global store registry and every data endpoint
 * returned 401 SESSION_DEAD on production.
 *
 * This module MUST stay free of NestJS decorators and of any import that could
 * cycle back into `session/` — it is imported by the stores themselves.
 */

/** 128-bit collision-proof session generation: 32 lowercase hex chars. */
export const SESSION_GENERATION_RE = /^[0-9a-f]{32}$/;

/** Generate a fresh session generation with Node stdlib crypto (128-bit). */
export function generateSessionGeneration(): string {
  return randomBytes(16).toString('hex');
}

/** True iff `v` is a well-formed session generation (32 lowercase hex). */
export function isSessionGeneration(v: unknown): v is string {
  return typeof v === 'string' && SESSION_GENERATION_RE.test(v);
}

/** One captured login session, keyed by identity in the SessionStore. */
export interface CapturedSession {
  identity: string;
  ssoCookie: string;
  microsoftCookie: string;
  kulonCookie: string;
  siapCookie: string;
  /** Email SSO mahasiswa (dari profil SIAP). Wajib utk mint token API resmi. */
  emailSso?: string;
  /** Wall-clock capture time — LIFETIME ONLY (absolute TTL bound). Never used as a JWT binding. */
  capturedAt: number;
  /**
   * Collision-proof session binding (128-bit crypto randomness, 32 lowercase
   * hex). Fresh on every newly captured/stored session; the signed JWT claim
   * `sessionGeneration` must exactly equal the live store record. Legacy
   * records/tokens lacking it are intentionally rejected (one-time relogin).
   */
  sessionGeneration: string;
}
