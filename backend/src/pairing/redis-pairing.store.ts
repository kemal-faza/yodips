import type Redis from 'ioredis';
import { PairingRecord, PairingStore } from './pairing-store';

const seconds = (ms: number) => Math.max(1, Math.floor(ms / 1000));

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
  }

  async get(codeHash: string): Promise<PairingRecord | null> {
    const raw = await this.client.get(`pair:${codeHash}`);
    return raw ? (JSON.parse(raw) as PairingRecord) : null;
  }

  /**
   * GETDEL = get-and-delete atomik (Redis ≥6.2). Bila server tua, fallback ke
   * skrip CAS (tetap atomik): GET lalu DEL dalam satu eval.
   */
  async consume(codeHash: string): Promise<PairingRecord | null> {
    const key = `pair:${codeHash}`;
    try {
      const raw = await this.client.getdel(key);
      return raw ? (JSON.parse(raw) as PairingRecord) : null;
    } catch {
      const raw = (await this.client.eval(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v;",
        1,
        key,
      )) as string | null;
      return raw ? (JSON.parse(raw) as PairingRecord) : null;
    }
  }
}
