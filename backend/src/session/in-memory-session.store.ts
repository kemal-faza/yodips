import { Injectable, Logger } from '@nestjs/common';
import type { CapturedSession, SessionRef } from './session-contract';
import { isUpstreamCookieRenewal, sameCapturedSession, SessionStore } from './session-store';
import { evaluateRecord } from './session-record-policy';

interface StoredRecord {
  session: CapturedSession;
  expiresAt: number;
}

/** Composite storage key: one record per user AND device/surface. */
function keyOf(session: { identity: string; clientId: string }): string {
  return `${session.identity}:${session.clientId}`;
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

  async set(session: CapturedSession): Promise<void> {
    this.records.set(keyOf(session), { session, expiresAt: Date.now() + this.ttlMs });
    this.logger.log('SSO session stored');
  }

  /**
   * Device- and generation-qualified snapshot. Synchronous check+return with
   * NO await between them, so no interleaving is possible on the
   * single-threaded event loop. Expiry/absolute-dead are evaluated BEFORE the
   * generation compare (dead → deleted, null either way); mismatch never
   * slides or deletes; match slides exactly like a live read. All of that
   * ordering lives in `evaluateRecord`.
   */
  async getIfGeneration(ref: SessionRef): Promise<CapturedSession | null> {
    const key = keyOf({ identity: ref.sub, clientId: ref.clientId });
    const record = this.records.get(key) ?? null;
    const decision = evaluateRecord(record, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    if (decision.kind === 'live') {
      if (record) record.expiresAt = decision.expiresAt;
      return decision.session;
    }
    if (decision.kind === 'expired' || decision.kind === 'absolute-dead') {
      this.records.delete(key);
    }
    return null;
  }

  async replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const key = keyOf({ identity: ref.sub, clientId: ref.clientId });
    const record = this.records.get(key) ?? null;
    const decision = evaluateRecord(record, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    if (decision.kind === 'generation-mismatch') return 'conflict';
    if (decision.kind === 'expired' || decision.kind === 'absolute-dead') {
      this.records.delete(key);
      return 'dead';
    }
    if (decision.kind !== 'live' || !record) return 'dead';
    if (!sameCapturedSession(record.session, expected)) return 'conflict';
    if (!isUpstreamCookieRenewal(ref, expected, replacement)) {
      throw new Error('Invalid session renewal replacement');
    }
    record.session = replacement;
    record.expiresAt = Date.now() + this.ttlMs;
    return 'updated';
  }

  /**
   * Atomic compare-and-clear. Synchronous check+delete with NO await between
   * them, so no interleaving is possible on the single-threaded event loop.
   * Expired/absolute-dead records are treated as absent (deleted, true).
   */
  async clearIfGeneration(ref: SessionRef): Promise<boolean> {
    const key = keyOf({ identity: ref.sub, clientId: ref.clientId });
    const decision = evaluateRecord(this.records.get(key) ?? null, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    switch (decision.kind) {
      case 'absent':
        return true;
      case 'generation-mismatch':
        return false;
      case 'expired':
      case 'absolute-dead':
      case 'live':
        this.records.delete(key);
        return true;
    }
  }

  async listBySub(sub: string): Promise<CapturedSession[]> {
    const now = Date.now();
    const out: CapturedSession[] = [];
    for (const [key, record] of this.records) {
      if (record.session.identity !== sub) continue;
      const decision = evaluateRecord(record, now, {
        ttlMs: this.ttlMs,
        absoluteMs: this.absoluteMs,
      });
      if (decision.kind === 'live') out.push(decision.session);
      else this.records.delete(key);
    }
    return out;
  }

  async clearAllForSub(sub: string): Promise<number> {
    let cleared = 0;
    for (const [key, record] of this.records) {
      if (record.session.identity !== sub) continue;
      this.records.delete(key);
      cleared += 1;
    }
    return cleared;
  }

  async all(): Promise<CapturedSession[]> {
    const now = Date.now();
    const result: CapturedSession[] = [];
    for (const [key, record] of this.records) {
      const decision = evaluateRecord(record, now, {
        ttlMs: this.ttlMs,
        absoluteMs: this.absoluteMs,
      });
      if (decision.kind === 'live') result.push(decision.session);
      else this.records.delete(key);
    }
    return result;
  }

  async migrateLegacyKeys(): Promise<{ scanned: number; migrated: number }> {
    return { scanned: 0, migrated: 0 };
  }
}
