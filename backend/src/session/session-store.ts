import type { CapturedSession, SessionRef } from './session-contract';

// Backward-compatible re-export: `SessionRef`/`isSessionRef` now live in the
// dependency-neutral contract so controllers/pairing/dashboard stop importing
// the store port just for a validator. Kept here so existing importers (and
// out-of-scope modules) keep working; new code imports from session-contract.
export { isSessionRef } from './session-contract';
export type { SessionRef } from './session-contract';

/**
 * Session store interface, keyed by the composite `<sub>:<clientId>` (NIM plus
 * device/surface ID). Implementations are async and apply a TTL (sliding on
 * access) PLUS an optional ABSOLUTE lifetime: implementations that receive
 * `absoluteMs` return null from `getIfGeneration()`/`all()` when
 * `now - session.capturedAt >= absoluteMs`, independent of the sliding TTL
 * (refresh can never extend a session past its absolute bound — YD-AUTH-001).
 * When `absoluteMs` is absent the store behaves exactly as sliding-only.
 * `capturedAt` is lifetime only; the JWT/session binding is the
 * collision-proof `sessionGeneration` (32 lowercase hex).
 * Bound to the DI token `SessionStore`; swap via SESSION_BACKEND.
 *
 * DI RULE (2026-09-05, SESSION_DEAD production blocker): every consumer MUST
 * receive the store through MANDATORY constructor injection (`@Inject`), and
 * SessionModule MUST be in the importing module's `imports` so Nest builds a
 * real dependency edge to the async `useFactory` that awaits Redis
 * connect()/ping(). There is deliberately NO process-global registry and NO
 * `@Optional()` fallback here anymore: a provider constructed before the
 * store exists (or in a module context that does not export it) must FAIL
 * THE BOOTSTRAP loudly instead of capturing `undefined` and answering every
 * data request with 401 SESSION_DEAD.
 */
export abstract class SessionStore {
  abstract set(session: CapturedSession): Promise<void>;
  /**
   * Device- and generation-qualified snapshot: return the live record for
   * `ref.sub` + `ref.clientId` ONLY if its `sessionGeneration` exactly equals
   * `ref.sessionGeneration`.
   * - No record, expired/sliding-dead, absolute-dead, legacy (no generation),
   *   or generation mismatch → null (mismatch/dead must NEVER slide the TTL
   *   or destroy the live record).
   * - Match → the live session (implementations slide the TTL exactly as a
   *   live read does).
   * InMemory performs check+return synchronously (no await between them, so
   * no interleaving). Redis GETs the envelope, enforces the absolute cap
   * BEFORE the generation compare (CAS-cleanup on dead, null either way),
   * then compares the decrypted generation and EXPIRE-slides only on match.
   * This is the single seam every token-facing cookie retrieval funnels
   * through: the guard validates A, the service re-reads with A's exact
   * generation, and a B-replacement between the two is a null (SESSION_DEAD)
   * instead of a silent use of B's cookies.
   */
  abstract getIfGeneration(ref: SessionRef): Promise<CapturedSession | null>;
  /** Atomically replace a snapshot only while it still equals the value read
   * before upstream validation. `dead` means the requested device/generation
   * has no live record; `conflict` means a newer update won and must be
   * preserved. */
  abstract replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'>;
  /**
   * Atomic compare-and-clear: delete the record for `ref.sub` + `ref.clientId`
   * ONLY if its live `sessionGeneration` exactly equals `ref.sessionGeneration`.
   * - No record (or already-expired/absolute-dead record) → true (idempotent ok).
   * - Generation mismatch, or the CAS lost to a newer record → false (caller
   *   maps to SESSION_DEAD and must NEVER clear the newer session).
   * InMemory performs check+delete synchronously (no await between them, so no
   * interleaving). Redis reads the envelope, checks the decrypted generation,
   * then Lua-compare-and-DELs the exact raw envelope read (false if changed).
   */
  abstract clearIfGeneration(ref: SessionRef): Promise<boolean>;
  /** Every live record owned by `sub` (one per device). */
  abstract listBySub(sub: string): Promise<CapturedSession[]>;
  /** Remove every record owned by `sub`; returns the number removed. */
  abstract clearAllForSub(sub: string): Promise<number>;
  /** Every live record across all users (background jobs only). */
  abstract all(): Promise<CapturedSession[]>;
  /**
   * One-time startup migration of pre-device keys (`sso:session:<sub>`) to
   * the composite key with `clientId: legacy`. InMemory has nothing to
   * migrate and returns zeroes.
   */
  abstract migrateLegacyKeys(): Promise<{ scanned: number; migrated: number }>;
}

/** Full session snapshot comparison shared by both storage adapters. */
export function sameCapturedSession(a: CapturedSession, b: CapturedSession): boolean {
  return a.identity === b.identity &&
    a.clientId === b.clientId &&
    a.ssoCookie === b.ssoCookie &&
    a.microsoftCookie === b.microsoftCookie &&
    a.kulonCookie === b.kulonCookie &&
    a.siapCookie === b.siapCookie &&
    a.emailSso === b.emailSso &&
    a.capturedAt === b.capturedAt &&
    a.sessionGeneration === b.sessionGeneration;
}

/** Enforce the immutable fields of an in-place Kulon-cookie renewal. */
export function isKulonCookieRenewal(
  ref: SessionRef,
  expected: CapturedSession,
  replacement: CapturedSession,
): boolean {
  return expected.identity === ref.sub &&
    expected.clientId === ref.clientId &&
    expected.sessionGeneration === ref.sessionGeneration &&
    replacement.identity === expected.identity &&
    replacement.clientId === expected.clientId &&
    replacement.sessionGeneration === expected.sessionGeneration &&
    replacement.kulonCookie.trim().length > 0 &&
    replacement.kulonCookie !== expected.kulonCookie &&
    replacement.capturedAt === expected.capturedAt &&
    replacement.ssoCookie === expected.ssoCookie &&
    replacement.microsoftCookie === expected.microsoftCookie &&
    replacement.siapCookie === expected.siapCookie &&
    replacement.emailSso === expected.emailSso;
}

/** Enforce the immutable fields of an in-place SIAP-cookie renewal. */
export function isSiapCookieRenewal(
  ref: SessionRef,
  expected: CapturedSession,
  replacement: CapturedSession,
): boolean {
  return expected.identity === ref.sub &&
    expected.clientId === ref.clientId &&
    expected.sessionGeneration === ref.sessionGeneration &&
    replacement.identity === expected.identity &&
    replacement.clientId === expected.clientId &&
    replacement.sessionGeneration === expected.sessionGeneration &&
    replacement.siapCookie.trim().length > 0 &&
    replacement.siapCookie !== expected.siapCookie &&
    replacement.kulonCookie === expected.kulonCookie &&
    replacement.capturedAt === expected.capturedAt &&
    replacement.ssoCookie === expected.ssoCookie &&
    replacement.microsoftCookie === expected.microsoftCookie &&
    replacement.emailSso === expected.emailSso;
}

/** Enforce the immutable fields of an in-place SSO-cookie renewal. */
export function isSsoCookieRenewal(
  ref: SessionRef,
  expected: CapturedSession,
  replacement: CapturedSession,
): boolean {
  return expected.identity === ref.sub &&
    expected.clientId === ref.clientId &&
    expected.sessionGeneration === ref.sessionGeneration &&
    replacement.identity === expected.identity &&
    replacement.clientId === expected.clientId &&
    replacement.sessionGeneration === expected.sessionGeneration &&
    replacement.ssoCookie.trim().length > 0 &&
    replacement.ssoCookie !== expected.ssoCookie &&
    replacement.capturedAt === expected.capturedAt &&
    replacement.microsoftCookie === expected.microsoftCookie &&
    replacement.kulonCookie === expected.kulonCookie &&
    replacement.siapCookie === expected.siapCookie &&
    replacement.emailSso === expected.emailSso;
}

/** Permit exactly one changed upstream cookie while keeping the session binding. */
export function isUpstreamCookieRenewal(
  ref: SessionRef,
  expected: CapturedSession,
  replacement: CapturedSession,
): boolean {
  return isKulonCookieRenewal(ref, expected, replacement) ||
    isSiapCookieRenewal(ref, expected, replacement) ||
    isSsoCookieRenewal(ref, expected, replacement);
}
