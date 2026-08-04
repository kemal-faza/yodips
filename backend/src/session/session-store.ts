import { CapturedSession } from '../playwright/playwright-auth.service';

/**
 * Session store interface, keyed by user identity (NIM).
 * Implementations are async and apply a TTL (sliding on access).
 * Bound to the DI token `SessionStore`; swap via SESSION_BACKEND.
 */
export abstract class SessionStore {
  abstract set(identity: string, session: CapturedSession): Promise<void>;
  abstract get(identity: string): Promise<CapturedSession | null>;
  abstract clear(identity: string): Promise<void>;
  abstract all(): Promise<CapturedSession[]>;
}