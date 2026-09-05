import { CapturedSession } from '../playwright/playwright-auth.service';

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
 */
export abstract class SessionStore {
  abstract set(identity: string, session: CapturedSession): Promise<void>;
  abstract get(identity: string): Promise<CapturedSession | null>;
  abstract clear(identity: string): Promise<void>;
  abstract all(): Promise<CapturedSession[]>;
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