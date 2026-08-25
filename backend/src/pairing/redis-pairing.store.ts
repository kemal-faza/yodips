import type Redis from 'ioredis';
import { PairingConsumeResult, PairingRecord, PairingStore } from './pairing-store';

const seconds = (ms: number) => Math.max(1, Math.floor(ms / 1000));

/** Grace window tombstone setelah key utama kedaluwarsa: dalam jendela ini
 *  consume-miss dilaporkan 'expired', selebihnya 'invalid'. */
export const EXPIRED_TOMBSTONE_GRACE_MS = 60_000;

export class RedisPairingStore extends PairingStore {
  constructor(private readonly client: Redis) {
    super();
  }

  async set(codeHash: string, record: PairingRecord, ttlMs: number): Promise<void> {
    await this.client.set(
      `pair:${codeHash}`,
      JSON.stringify(record),
      'EX',
      seconds(ttlMs),
    );
    // Tombstone: bertahan lebih lama dari key utama supaya consume-miss sesaat
    // setelah kedaluwarsa bisa dilaporkan EXPIRED (bukan INVALID).
    await this.client.set(
      `pair-exp:${codeHash}`,
      '1',
      'EX',
      seconds(ttlMs + EXPIRED_TOMBSTONE_GRACE_MS),
    );
  }

  async get(codeHash: string): Promise<PairingRecord | null> {
    const raw = await this.client.get(`pair:${codeHash}`);
    return raw ? (JSON.parse(raw) as PairingRecord) : null;
  }

  /**
   * GETDEL = get-and-delete atomik (Redis ≥6.2). Bila server tua, fallback ke
   * skrip CAS (tetap atomik): GET lalu DEL dalam satu eval. Miss → cek
   * tombstone untuk membedakan expired vs invalid.
   */
  async consume(codeHash: string): Promise<PairingConsumeResult> {
    const key = `pair:${codeHash}`;
    let raw: string | null;
    try {
      raw = await this.client.getdel(key);
    } catch {
      raw = (await this.client.eval(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v;",
        1,
        key,
      )) as string | null;
    }
    if (raw) return { status: 'consumed', record: JSON.parse(raw) as PairingRecord };
    const tombstone = await this.client.get(`pair-exp:${codeHash}`);
    return tombstone ? { status: 'expired' } : { status: 'invalid' };
  }
}
