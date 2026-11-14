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

/** Client installation/surface ID. UUID v4 is recommended. */
export const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const LEGACY_CLIENT_ID = 'legacy';

/** Client-supplied ID: never the reserved legacy value. */
export function isClientId(v: unknown): v is string {
  return typeof v === 'string' && v !== LEGACY_CLIENT_ID && CLIENT_ID_RE.test(v);
}

/** Stored/ref ID: a client ID or the internal legacy sentinel. */
export function isStoredClientId(v: unknown): v is string {
  return v === LEGACY_CLIENT_ID || isClientId(v);
}

/** Generate a fresh session generation with Node stdlib crypto (128-bit). */
export function generateSessionGeneration(): string {
  return randomBytes(16).toString('hex');
}

/** True iff `v` is a well-formed session generation (32 lowercase hex). */
export function isSessionGeneration(v: unknown): v is string {
  return typeof v === 'string' && SESSION_GENERATION_RE.test(v);
}

/**
 * Device-qualified reference to one login session: the JWT `sub`, the
 * installation/surface `clientId`, and the exact `sessionGeneration` the token
 * was minted against. Every token-facing (JwtAuthGuard-authenticated) read of
 * the session store MUST carry ALL THREE — a `sub`-only read is a TOCTOU
 * between devices too. Threading the exact generation through to the adapter
 * that retrieves cookies (via `getIfGeneration`) closes that window: a
 * replaced record is a miss (SESSION_DEAD), never a silent switch to the
 * replacement's cookies.
 *
 * Lives in the dependency-neutral contract (NOT the store port) so
 * controllers, dashboard and pairing can validate a ref without importing the
 * whole store.
 */
export interface SessionRef {
  sub: string;
  clientId: string;
  sessionGeneration: string;
}

/** True iff `v` is a well-formed SessionRef (non-empty sub + stored client ID + 32-hex generation). */
export function isSessionRef(v: unknown): v is SessionRef {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { sub?: unknown; clientId?: unknown; sessionGeneration?: unknown };
  return (
    typeof r.sub === 'string' &&
    r.sub.length > 0 &&
    isStoredClientId(r.clientId) &&
    isSessionGeneration(r.sessionGeneration)
  );
}

/** One captured login session, keyed by `<identity>:<clientId>` in the SessionStore. */
export interface CapturedSession {
  identity: string;
  /** Device/surface that owns this record. `legacy` during the P1 rollout. */
  clientId: string;
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
