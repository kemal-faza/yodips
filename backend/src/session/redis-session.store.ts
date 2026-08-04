import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
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

  constructor(
    private readonly client: Redis,
    private readonly ttlMs: number,
    encKey: string,
  ) {
    super();
    this.key = createHash('sha256').update(encKey).digest();
  }

  async set(identity: string, session: CapturedSession): Promise<void> {
    const envelope = this.encrypt(JSON.stringify(session));
    await this.client.set(`${KEY_PREFIX}${identity}`, envelope, 'EX', this.ttlMs);
    this.logger.log(`SSO session stored for ${identity}`);
  }

  async get(identity: string): Promise<CapturedSession | null> {
    const key = `${KEY_PREFIX}${identity}`;
    const envelope = await this.client.get(key);
    if (!envelope) return null;
    const session = this.decrypt(envelope);
    if (!session) return null;
    // Sliding TTL: refresh on access.
    await this.client.expire(key, this.ttlMs);
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

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  private decrypt(envelope: string): CapturedSession | null {
    try {
      const [version, ivB64, tagB64, ctB64] = envelope.split(':');
      if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) return null;
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
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