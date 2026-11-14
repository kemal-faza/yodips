import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import Redis from 'ioredis';
import { CapturedSession, LEGACY_CLIENT_ID, SessionRef } from './session-contract';
import { isUpstreamCookieRenewal, sameCapturedSession, SessionStore } from './session-store';
import { evaluateRecord } from './session-record-policy';

const KEY_PREFIX = 'sso:session:';
const SCAN_BATCH = 100;

/** Composite storage key: one record per user AND device/surface. */
function keyFor(identity: string, clientId: string): string {
  return `${KEY_PREFIX}${identity}:${clientId}`;
}
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
/**
 * Atomic compare-and-delete: DEL only if the current value still equals the
 * exact envelope read earlier. Returns 1 when deleted, 0 when replaced.
 */
const CAS_DELETE_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

/**
 * Atomic compare-and-expire: EXPIRE only if the current value still equals
 * the exact envelope read earlier. Returns 1 when slid, 0 when replaced.
 * A stale qualified read (A) that loses this CAS to a B-replacement returns
 * null and never slides B's TTL.
 */
const CAS_EXPIRE_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], ARGV[2]) else return 0 end`;

/** Atomic replacement guarded by the exact encrypted envelope read earlier. */
const CAS_REPLACE_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3]); return 1 else return 0 end`;

/**
 * Redis-backed SessionStore for production.
 * - Key: `sso:session:{identity}:{clientId}` (one record per device/surface).
 * - Value: envelope `v1:<iv>:<tag>:<ct>` (base64), AES-256-GCM encrypted.
 * - TTL: 7 days sliding — `SET ... EX ttl` on write, `EXPIRE` again on read.
 * Decrypt failure (tamper/wrong key) → reads return null (safe default).
 */
@Injectable()
export class RedisSessionStore extends SessionStore implements OnModuleDestroy {
  private readonly logger = new Logger(RedisSessionStore.name);
  private readonly key: Buffer;
  private readonly absoluteMs?: number;

  constructor(
    private readonly client: Redis,
    private readonly ttlMs: number,
    encKey: string,
    absoluteMs?: number,
  ) {
    super();
    // Derive the AES-256 key from the config secret with scrypt (a memory-hard
    // KDF) rather than a single SHA-256 — resists offline brute force if the
    // secret is weak. 32-byte salt + 256-bit output; same salt per key is fine
    // here because the SESSION_ENC_KEY is a deployment secret, not per-user.
    this.key = scryptSync(encKey, 'yodips-session', 32);
    this.absoluteMs = absoluteMs;
  }

  async set(session: CapturedSession): Promise<void> {
    const envelope = this.encrypt(JSON.stringify(session));
    await this.client.set(
      keyFor(session.identity, session.clientId),
      envelope,
      'EX',
      this.ttlSeconds(),
    );
    this.logger.log('SSO session stored');
  }

  /**
   * Atomic compare-and-clear on the exact device record. Reads the envelope,
   * enforces the absolute cap BEFORE the generation compare (an absolute-dead
   * record is CAS-cleaned and reports true when the cleanup wins / no live
   * record remains, false when the CAS lost to a newer replacement),
   * then Lua-CAS-DELs the exact raw envelope.
   * No record → true; generation mismatch or CAS lost → false.
   */
  async clearIfGeneration(ref: SessionRef): Promise<boolean> {
    const key = keyFor(ref.sub, ref.clientId);
    const envelope = await this.client.get(key);
    if (!envelope) return true;
    const session = this.decrypt(envelope);
    if (!session) {
      // Corrupt/tampered envelope: attempt to remove exactly that envelope so a
      // newer valid replacement (if any) is never touched. Deleted → true
      // (idempotent); changed → false (newer record wins → SESSION_DEAD).
      const deleted = await this.casDeleteIfEqual(key, envelope);
      return deleted === 1;
    }
    // Shared policy: absolute-dead BEFORE the generation compare (parity with
    // InMemory). A dead record is cleaned via the exact-envelope CAS. A won
    // CAS (or no live record) → true; a lost CAS (B-replacement landed) →
    // false so the caller maps to SESSION_DEAD and never clears B.
    const decision = evaluateRecord({ session }, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    switch (decision.kind) {
      case 'generation-mismatch':
        return false;
      case 'live':
      case 'absolute-dead': {
        const deleted = await this.casDeleteIfEqual(key, envelope);
        return deleted === 1;
      }
      case 'absent':
      case 'expired':
        // Unreachable: an envelope exists and Redis owns the sliding TTL.
        return true;
    }
  }

  /**
   * Generation-qualified snapshot of one device record. GETs the envelope,
   * enforces the absolute cap BEFORE the generation compare (dead →
   * exact-envelope CAS-cleanup, null either way, never a slide), returns null
   * on decrypt failure (exact-envelope CAS-cleanup, null either way) or
   * generation mismatch (no slide, no delete), and EXPIRE-slides only on an
   * exact live match — via the Lua compare-and-expire of the exact envelope
   * read, so a B-replacement between GET and slide loses the CAS (null, B
   * untouched).
   */
  async getIfGeneration(ref: SessionRef): Promise<CapturedSession | null> {
    const key = keyFor(ref.sub, ref.clientId);
    const envelope = await this.client.get(key);
    if (!envelope) return null;
    const session = this.decrypt(envelope);
    if (!session) {
      await this.casDeleteIfEqual(key, envelope);
      return null;
    }
    const decision = evaluateRecord({ session }, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    if (decision.kind === 'absolute-dead') {
      await this.casDeleteIfEqual(key, envelope);
      return null;
    }
    if (decision.kind !== 'live') {
      // generation-mismatch never slides or deletes; absent/expired are
      // unreachable here (an envelope exists and Redis owns the sliding TTL).
      return null;
    }
    const slid = await this.casExpireIfEqual(key, envelope, this.ttlSeconds());
    if (slid !== 1) return null;
    return session;
  }

  async replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const key = keyFor(ref.sub, ref.clientId);
    const envelope = await this.client.get(key);
    if (!envelope) return 'dead';
    const session = this.decrypt(envelope);
    if (!session) {
      await this.casDeleteIfEqual(key, envelope);
      return 'dead';
    }
    const decision = evaluateRecord({ session }, Date.now(), {
      ttlMs: this.ttlMs,
      absoluteMs: this.absoluteMs,
      generation: ref.sessionGeneration,
    });
    if (decision.kind === 'generation-mismatch') return 'conflict';
    if (decision.kind === 'absolute-dead') {
      await this.casDeleteIfEqual(key, envelope);
      return 'dead';
    }
    if (decision.kind !== 'live') return 'dead';
    if (!sameCapturedSession(session, expected)) return 'conflict';
    if (!isUpstreamCookieRenewal(ref, expected, replacement)) {
      throw new Error('Invalid session renewal replacement');
    }

    const nextEnvelope = this.encrypt(JSON.stringify(replacement));
    const replaced = await this.casReplaceIfEqual(
      key,
      envelope,
      nextEnvelope,
      this.ttlSeconds(),
    );
    return replaced === 1 ? 'updated' : 'conflict';
  }

  private async casExpireIfEqual(key: string, expectedEnvelope: string, ttlSeconds: number): Promise<number> {
    const res = await (this.client as unknown as {
      eval: (script: string, numKeys: number, key: string, ...args: unknown[]) => Promise<unknown>;
    }).eval(CAS_EXPIRE_LUA, 1, key, expectedEnvelope, ttlSeconds);
    return res === 1 || res === '1' ? 1 : 0;
  }

  private async casDeleteIfEqual(key: string, expectedEnvelope: string): Promise<number> {
    const res = await (this.client as unknown as {
      eval: (script: string, numKeys: number, key: string, arg: string) => Promise<unknown>;
    }).eval(CAS_DELETE_LUA, 1, key, expectedEnvelope);
    return res === 1 || res === '1' ? 1 : 0;
  }

  private async casReplaceIfEqual(
    key: string,
    expectedEnvelope: string,
    nextEnvelope: string,
    ttlSeconds: number,
  ): Promise<number> {
    const res = await (this.client as unknown as {
      eval: (
        script: string,
        numKeys: number,
        key: string,
        ...args: unknown[]
      ) => Promise<unknown>;
    }).eval(CAS_REPLACE_LUA, 1, key, expectedEnvelope, nextEnvelope, ttlSeconds);
    return res === 1 || res === '1' ? 1 : 0;
  }

  /**
   * Every live device record owned by `sub`. The prefix scan can over-match
   * only on exotic glob characters in a NIM, so the decrypted `identity` is
   * always checked before a record is returned. Absolute-dead records are
   * CAS-cleaned exactly like the qualified reads.
   */
  async listBySub(sub: string): Promise<CapturedSession[]> {
    const result: CapturedSession[] = [];
    const now = Date.now();
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}${sub}:*`,
        'COUNT',
        SCAN_BATCH,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.client.mget(keys);
      for (let i = 0; i < keys.length; i++) {
        const envelope = values[i];
        if (!envelope) continue;
        const session = this.decrypt(envelope);
        if (!session || session.identity !== sub) continue;
        const decision = evaluateRecord({ session }, now, {
          ttlMs: this.ttlMs,
          absoluteMs: this.absoluteMs,
        });
        if (decision.kind === 'live') {
          result.push(decision.session);
        } else if (decision.kind === 'absolute-dead') {
          await this.casDeleteIfEqual(keys[i], envelope);
        }
      }
    } while (cursor !== '0');
    return result;
  }

  /**
   * Remove every device record for `sub`, including the pre-device unscoped
   * key (`sso:session:<sub>`) that may still exist until migration runs.
   */
  async clearAllForSub(sub: string): Promise<number> {
    let cleared = 0;
    const legacyRemoved = await this.client.del(`${KEY_PREFIX}${sub}`);
    cleared += Number(legacyRemoved) || 0;

    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}${sub}:*`,
        'COUNT',
        SCAN_BATCH,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const removed = await this.client.del(...keys);
      cleared += Number(removed) || 0;
    } while (cursor !== '0');
    return cleared;
  }

  /** Every live record across all users (background jobs only). */
  async all(): Promise<CapturedSession[]> {
    const result: CapturedSession[] = [];
    const now = Date.now();
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', SCAN_BATCH);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.client.mget(keys);
      for (let i = 0; i < keys.length; i++) {
        const envelope = values[i];
        if (!envelope) continue;
        const session = this.decrypt(envelope);
        if (!session) continue;
        const decision = evaluateRecord({ session }, now, {
          ttlMs: this.ttlMs,
          absoluteMs: this.absoluteMs,
        });
        if (decision.kind === 'live') {
          result.push(decision.session);
        } else if (decision.kind === 'absolute-dead') {
          await this.casDeleteIfEqual(keys[i], envelope);
        }
      }
    } while (cursor !== '0');
    return result;
  }

  /**
   * One-time startup migration of pre-device keys:
   * `sso:session:<sub>` → `sso:session:<sub>:legacy`.
   *
   * Only single-segment suffixes are old records; already-composite keys are
   * skipped. A newer composite record (greater `capturedAt`) wins, but the old
   * key is removed either way. The old key's remaining PTTL is preserved with
   * `SET ... PX`; a missing/expired PTTL falls back to the configured TTL.
   * Returns only counts — never log IDs or cookies from here.
   */
  async migrateLegacyKeys(): Promise<{ scanned: number; migrated: number }> {
    let cursor = '0';
    let scanned = 0;
    let migrated = 0;
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}*`,
        'COUNT',
        SCAN_BATCH,
      );
      cursor = next;
      for (const key of keys) {
        const suffix = key.slice(KEY_PREFIX.length);
        if (suffix.split(':').length !== 1) continue; // already composite
        scanned += 1;
        const envelope = await this.client.get(key);
        if (!envelope) continue;
        const session = this.decrypt(envelope);
        if (!session) continue;
        const nextSession: CapturedSession = { ...session, clientId: LEGACY_CLIENT_ID };
        const nextKey = keyFor(session.identity, LEGACY_CLIENT_ID);
        const targetEnvelope = await this.client.get(nextKey);
        const target = targetEnvelope ? this.decrypt(targetEnvelope) : null;
        if (!target || target.capturedAt <= session.capturedAt) {
          const pttl = await this.client.pttl(key);
          const nextEnvelope = this.encrypt(JSON.stringify(nextSession));
          if (pttl > 0) {
            await this.client.set(nextKey, nextEnvelope, 'PX', pttl);
          } else {
            await this.client.set(nextKey, nextEnvelope, 'EX', this.ttlSeconds());
          }
          migrated += 1;
        }
        await this.client.del(key);
      }
    } while (cursor !== '0');
    return { scanned, migrated };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** ttlMs is milliseconds; Redis EX/EXPIRE take seconds. */
  private ttlSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  private decrypt(envelope: string): CapturedSession | null {
    try {
      const parts = envelope.split(':');
      if (parts.length !== 4) return null;
      const [version, ivB64, tagB64, ctB64] = parts;
      if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) return null;
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      if (iv.length !== IV_LEN) return null; // 12-byte IV enforced
      if (tag.length !== 16) return null; // 16-byte GCM tag enforced
      // Explicit authTagLength (16) — Node's GCM default is already 16 bytes, so
      // this is a no-op hardening that pins the contract in case the default ever
      // changes. The 16-byte tag is enforced above (tag.length !== 16 → null).
      const decipher = createDecipheriv(ALGO, this.key, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as CapturedSession;
    } catch {
      return null;
    }
  }
}
