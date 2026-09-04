import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import Redis from 'ioredis';
import { CapturedSession } from '../playwright/playwright-auth.service';
import { SessionStore } from './session-store';

const KEY_PREFIX = 'sso:session:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

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
      await this.client.del(key);
      return null;
    }
    // Sliding TTL: refresh on access.
    await this.client.expire(key, this.ttlSeconds());
    return session;
  }

  async clear(identity: string): Promise<void> {
    await this.client.del(`${KEY_PREFIX}${identity}`);
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
      const decipher = createDecipheriv(ALGO, this.key, iv);
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