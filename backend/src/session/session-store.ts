import { CapturedSession, isSessionGeneration } from './session-contract';

/**
 * Generation-qualified reference to one login session: the JWT `sub` plus the
 * exact `sessionGeneration` the token was minted against. Every
 * token-facing (JwtAuthGuard-authenticated) read of the session store MUST
 * carry BOTH halves — a `sub`-only read is a TOCTOU: the guard validates
 * generation A, the store is replaced with generation B, and the service
 * then uses B's cookies for A's request. Threading the exact generation
 * through to the adapter that retrieves cookies (via `getIfGeneration`)
 * closes that window: a replaced record is a miss (SESSION_DEAD), never a
 * silent switch to the replacement's cookies.
 */
export interface SessionRef {
  sub: string;
  sessionGeneration: string;
}

/** True iff `v` is a well-formed SessionRef (non-empty sub + 32-hex generation). */
export function isSessionRef(v: unknown): v is SessionRef {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { sub?: unknown; sessionGeneration?: unknown };
  return (
    typeof r.sub === 'string' &&
    r.sub.length > 0 &&
    isSessionGeneration(r.sessionGeneration)
  );
}

/**
 * Session store interface, keyed by user identity (NIM).
 * Implementations are async and apply a TTL (sliding on access) PLUS an
 * optional ABSOLUTE lifetime: implementations that receive `absoluteMs`
 * return null from `get()` when `now - session.capturedAt >= absoluteMs`,
 * independent of the sliding TTL (refresh can never extend a session past
 * its absolute bound — YD-AUTH-001). When `absoluteMs` is absent the store
 * behaves exactly as sliding-only.
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
  abstract set(identity: string, session: CapturedSession): Promise<void>;
  abstract get(identity: string): Promise<CapturedSession | null>;
  abstract clear(identity: string): Promise<void>;
  abstract all(): Promise<CapturedSession[]>;
  /**
   * Generation-qualified snapshot: return the live record for `identity`
   * ONLY if its `sessionGeneration` exactly equals `generation`.
   * - No record, expired/sliding-dead, absolute-dead, legacy (no generation),
   *   or generation mismatch → null (mismatch/dead must NEVER slide the TTL
   *   or destroy the live record).
   * - Match → the live session (implementations slide the TTL exactly as
   *   `get()` does on a live hit).
   * InMemory performs check+return synchronously (no await between them, so
   * no interleaving). Redis GETs the envelope, enforces the absolute cap
   * BEFORE the generation compare (CAS-cleanup on dead, null either way),
   * then compares the decrypted generation and EXPIRE-slides only on match.
   * This is the single seam every token-facing cookie retrieval funnels
   * through: the guard validates A, the service re-reads with A's exact
   * generation, and a B-replacement between the two is a null (SESSION_DEAD)
   * instead of a silent use of B's cookies.
   */
  abstract getIfGeneration(identity: string, generation: string): Promise<CapturedSession | null>;
  /**
   * Atomic compare-and-clear: delete the record for `identity` ONLY if its
   * live `sessionGeneration` exactly equals `generation`.
   * - No record (or already-expired/absolute-dead record) → true (idempotent ok).
   * - Generation mismatch, or the CAS lost to a newer record → false (caller
   *   maps to SESSION_DEAD and must NEVER clear the newer session).
   * InMemory performs check+delete synchronously (no await between them, so no
   * interleaving). Redis reads the envelope, checks the decrypted generation,
   * then Lua-compare-and-DELs the exact raw envelope read (false if changed).
   */
  abstract clearIfGeneration(identity: string, generation: string): Promise<boolean>;
}
