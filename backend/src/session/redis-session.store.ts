import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import Redis from 'ioredis';
import { CapturedSession } from './session-contract';
import { SessionStore } from './session-store';

const KEY_PREFIX = 'sso:session:';
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

/**
 * Redis-backed SessionStore for production.
 * - Key: `sso:session:{identity}`
 * - Value: envelope `v1:<iv>:<tag>:<ct>` (base64), AES-256-GCM encrypted.
 * - TTL: 7 days sliding — `SET ... EX ttl` on write, `EXPIRE` again on read.
 * Decrypt failure (tamper/wrong key) → get() returns null (safe default).
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
    this.absoluteMs = absoluteMs && absoluteMs > 0 ? absoluteMs : undefined;
  }

  async set(identity: string, session: CapturedSession): Promise<void> {
    const envelope = this.encrypt(JSON.stringify(session));
    await this.client.set(`${KEY_PREFIX}${identity}`, envelope, 'EX', this.ttlSeconds());
    this.logger.log(`SSO session stored for ${identity}`);
  }

  async get(identity: string): Promise<CapturedSession | null> {
    const key = `${KEY_PREFIX}${identity}`;
    const envelope = await this.client.get(key);
    if (!envelope) return null;
    const session = this.decrypt(envelope);
    if (!session) return null;
    // Absolute lifetime: independent of the sliding TTL. Even though the Redis
    // record is still alive (sliding EXPIRE on access), a session captured
    // longer than absoluteMs ago is dead — refresh cannot extend it forever.
    if (
      this.absoluteMs !== undefined &&
      Date.now() - session.capturedAt >= this.absoluteMs
    ) {
      // Compare-and-delete the EXACT envelope read: never an unconditional DEL,
      // so a replacement stored between GET and cleanup (newer live session)
      // is never destroyed. A lost CAS still returns null for this stale read;
      // the next get() observes the fresh record.
      await this.casDeleteIfEqual(key, envelope);
      return null;
    }
    // Sliding TTL: refresh on access.
    await this.client.expire(key, this.ttlSeconds());
    return session;
  }

  async clear(identity: string): Promise<void> {
    await this.client.del(`${KEY_PREFIX}${identity}`);
  }

  /**
   * Atomic compare-and-clear on `sessionGeneration`. Reads the envelope,
   * enforces the absolute cap BEFORE the generation compare (an absolute-dead
   * record is CAS-cleaned and reports true when the cleanup wins / no live
   * record remains, false when the CAS lost to a newer replacement),
   * then Lua-CAS-DELs the exact raw envelope.
   * No record → true; generation mismatch or CAS lost → false.
   */
  async clearIfGeneration(identity: string, generation: string): Promise<boolean> {
    const key = `${KEY_PREFIX}${identity}`;
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
    // Absolute lifetime BEFORE the generation compare (parity with InMemory):
    // a capturedAt-dead record is cleaned via the exact-envelope CAS. A won
    // CAS (or no live record) → true; a lost CAS (B-replacement landed) →
    // false so the caller maps to SESSION_DEAD and never clears B.
    if (
      this.absoluteMs !== undefined &&
      Date.now() - session.capturedAt >= this.absoluteMs
    ) {
      const deleted = await this.casDeleteIfEqual(key, envelope);
      return deleted === 1;
    }
    if (session.sessionGeneration !== generation) return false;
    const deleted = await this.casDeleteIfEqual(key, envelope);
    return deleted === 1 ? true : false;
  }

  /**
   * Generation-qualified snapshot. GETs the envelope, enforces the absolute
   * cap BEFORE the generation compare (dead → exact-envelope CAS-cleanup,
   * null either way, never a slide), returns null on decrypt failure
   * (exact-envelope CAS-cleanup, null either way) or generation mismatch
   * (no slide, no delete), and EXPIRE-slides only on an exact live match —
   * via the Lua compare-and-expire of the exact envelope read, so a
   * B-replacement between GET and slide loses the CAS (null, B untouched).
   */
  async getIfGeneration(identity: string, generation: string): Promise<CapturedSession | null> {
    const key = `${KEY_PREFIX}${identity}`;
    const envelope = await this.client.get(key);
    if (!envelope) return null;
    const session = this.decrypt(envelope);
    if (!session) {
      await this.casDeleteIfEqual(key, envelope);
      return null;
    }
    if (
      this.absoluteMs !== undefined &&
      Date.now() - session.capturedAt >= this.absoluteMs
    ) {
      await this.casDeleteIfEqual(key, envelope);
      return null;
    }
    if (session.sessionGeneration !== generation) return null;
    const slid = await this.casExpireIfEqual(key, envelope, this.ttlSeconds());
    if (slid !== 1) return null;
    return session;
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

  async all(): Promise<CapturedSession[]> {
    const result: CapturedSession[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.client.mget(keys);
      for (const value of values) {
        const session = value ? this.decrypt(value) : null;
        if (session) result.push(session);
      }
    } while (cursor !== '0');
    return result;
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