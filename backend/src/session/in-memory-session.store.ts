import { Injectable, Logger } from '@nestjs/common';
import { CapturedSession } from './session-contract';
import { SessionStore } from './session-store';

interface StoredRecord {
  session: CapturedSession;
  expiresAt: number;
}

/**
 * In-memory SessionStore for dev/test (zero Redis dependency).
 * Mirrors RedisSessionStore semantics: TTL + sliding refresh on access.
 */
@Injectable()
export class InMemorySessionStore extends SessionStore {
  private readonly logger = new Logger(InMemorySessionStore.name);
  private readonly records = new Map<string, StoredRecord>();
  private readonly absoluteMs?: number;

  constructor(private readonly ttlMs: number, absoluteMs?: number) {
    super();
    this.absoluteMs = absoluteMs && absoluteMs > 0 ? absoluteMs : undefined;
  }

  async set(identity: string, session: CapturedSession): Promise<void> {
    this.records.set(identity, { session, expiresAt: Date.now() + this.ttlMs });
    this.logger.log(`SSO session stored for ${identity}`);
  }

  async get(identity: string): Promise<CapturedSession | null> {
    const record = this.records.get(identity);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.records.delete(identity);
      return null;
    }
    // Absolute lifetime: independent of the sliding TTL. A session captured
    // longer than absoluteMs ago is dead even while the sliding TTL keeps the
    // record alive — refresh can no longer extend a session forever.
    if (
      this.absoluteMs !== undefined &&
      Date.now() - record.session.capturedAt >= this.absoluteMs
    ) {
      this.records.delete(identity);
      return null;
    }
    // Sliding TTL: refresh on access (unchanged).
    record.expiresAt = Date.now() + this.ttlMs;
    return record.session;
  }

  async clear(identity: string): Promise<void> {
    this.records.delete(identity);
  }

  /**
   * Generation-qualified snapshot. Synchronous check+return with NO await
   * between them, so no interleaving is possible on the single-threaded
   * event loop. Expiry/absolute-dead are evaluated BEFORE the generation
   * compare (dead → deleted, null either way); mismatch never slides or
   * deletes; match slides exactly like `get()`.
   */
  async getIfGeneration(identity: string, generation: string): Promise<CapturedSession | null> {
    const record = this.records.get(identity);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.records.delete(identity);
      return null;
    }
    if (
      this.absoluteMs !== undefined &&
      Date.now() - record.session.capturedAt >= this.absoluteMs
    ) {
      this.records.delete(identity);
      return null;
    }
    if (record.session.sessionGeneration !== generation) return null;
    // Match: slide like get().
    record.expiresAt = Date.now() + this.ttlMs;
    return record.session;
  }

  /**
   * Atomic compare-and-clear. Synchronous check+delete with NO await between
   * them, so no interleaving is possible on the single-threaded event loop.
   * Expired/absolute-dead records are treated as absent (deleted, true).
   */
  async clearIfGeneration(identity: string, generation: string): Promise<boolean> {
    const record = this.records.get(identity);
    if (!record) return true;
    if (Date.now() > record.expiresAt) {
      this.records.delete(identity);
      return true;
    }
    if (
      this.absoluteMs !== undefined &&
      Date.now() - record.session.capturedAt >= this.absoluteMs
    ) {
      this.records.delete(identity);
      return true;
    }
    if (record.session.sessionGeneration !== generation) return false;
    this.records.delete(identity);
    return true;
  }

  async all(): Promise<CapturedSession[]> {
    const now = Date.now();
    const result: CapturedSession[] = [];
    for (const [identity, record] of this.records) {
      if (now > record.expiresAt) {
        this.records.delete(identity);
        continue;
      }
      result.push(record.session);
    }
    return result;
  }
}