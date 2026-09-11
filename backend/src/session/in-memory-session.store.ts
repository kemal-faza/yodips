import { Injectable, Logger } from '@nestjs/common';
import { CapturedSession } from './session-contract';
import { SessionStore } from './session-store';
import { evaluateRecord } from './session-record-policy';

interface StoredRecord {
  session: CapturedSession;
  expiresAt: number;
}

/**
 * In-memory SessionStore for dev/test (zero Redis dependency).
 * Mirrors RedisSessionStore semantics: TTL + sliding refresh on access.
 *
 * Storage-specific work only: the Map. Every lifetime/generation decision is
 * delegated to the shared `evaluateRecord` policy core so both adapters can
 * never drift on the rule.
 */
@Injectable()
export class InMemorySessionStore extends SessionStore {
  private readonly logger = new Logger(InMemorySessionStore.name);
  private readonly records = new Map<string, StoredRecord>();
  private readonly absoluteMs?: number;

  constructor(private readonly ttlMs: number, absoluteMs?: number) {
    super();
    this.absoluteMs = absoluteMs;
  }

  async set(identity: string, session: CapturedSession): Promise<void> {
    this.records.set(identity, { session, expiresAt: Date.now() + this.ttlMs });
    this.logger.log(`SSO session stored for ${identity}`);
  }

  async get(identity: string): Promise<CapturedSession | null> {
    const record = this.records.get(identity) ?? null;
    const decision = evaluateRecord(record, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
    });
    if (decision.kind === 'live') {
      if (record) record.expiresAt = decision.expiresAt;
      return decision.session;
    }
    if (decision.kind === 'expired' || decision.kind === 'absolute-dead') {
      this.records.delete(identity);
    }
    return null;
  }

  async clear(identity: string): Promise<void> {
    this.records.delete(identity);
  }

  /**
   * Generation-qualified snapshot. Synchronous check+return with NO await
   * between them, so no interleaving is possible on the single-threaded
   * event loop. Expiry/absolute-dead are evaluated BEFORE the generation
   * compare (dead → deleted, null either way); mismatch never slides or
   * deletes; match slides exactly like `get()`. All of that ordering lives in
   * `evaluateRecord`.
   */
  async getIfGeneration(identity: string, generation: string): Promise<CapturedSession | null> {
    const record = this.records.get(identity) ?? null;
    const decision = evaluateRecord(record, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation,
    });
    if (decision.kind === 'live') {
      if (record) record.expiresAt = decision.expiresAt;
      return decision.session;
    }
    if (decision.kind === 'expired' || decision.kind === 'absolute-dead') {
      this.records.delete(identity);
    }
    return null;
  }

  /**
   * Atomic compare-and-clear. Synchronous check+delete with NO await between
   * them, so no interleaving is possible on the single-threaded event loop.
   * Expired/absolute-dead records are treated as absent (deleted, true).
   */
  async clearIfGeneration(identity: string, generation: string): Promise<boolean> {
    const decision = evaluateRecord(this.records.get(identity) ?? null, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation,
    });
    switch (decision.kind) {
      case 'absent':
        return true;
      case 'generation-mismatch':
        return false;
      case 'expired':
      case 'absolute-dead':
      case 'live':
        this.records.delete(identity);
        return true;
    }
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
