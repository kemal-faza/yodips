import { CapturedSession } from '../playwright/playwright-auth.service';

/**
 * Session store interface, keyed by user identity (NIM).
 * Implementations are async and apply a TTL (sliding on access) PLUS an
 * optional ABSOLUTE lifetime: implementations that receive `absoluteMs`
 * return null from `get()` when `now - session.capturedAt >= absoluteMs`,
 * independent of the sliding TTL (refresh can never extend a session past
 * its absolute bound — YD-AUTH-001). When `absoluteMs` is absent the store
 * behaves exactly as sliding-only.
 * Bound to the DI token `SessionStore`; swap via SESSION_BACKEND.
 */
export abstract class SessionStore {
  abstract set(identity: string, session: CapturedSession): Promise<void>;
  abstract get(identity: string): Promise<CapturedSession | null>;
  abstract clear(identity: string): Promise<void>;
  abstract all(): Promise<CapturedSession[]>;
}