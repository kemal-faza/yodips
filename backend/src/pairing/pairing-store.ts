export interface PairingRecord {
  /** Identitas pemilik sesi sumber (NIM, dari JWT guard — bukan dari client). */
  sub: string;
  /** Epoch ms kedaluwarsa (informasional; TTL efektif di tiap implementasi). */
  expiresAt: number;
}

/**
 * Store kode pairing sekali-pakai, keyed by sha256(kode).
 * Pola ala SessionStore/NotificationStore: InMemory dev/test, Redis prod.
 */
export abstract class PairingStore {
  abstract set(codeHash: string, record: PairingRecord, ttlMs: number): Promise<void>;
  abstract get(codeHash: string): Promise<PairingRecord | null>;
  /** Ambil sekaligus HAPUS atomik; null bila miss/expired. */
  abstract consume(codeHash: string): Promise<PairingRecord | null>;
}

interface Entry {
  record: PairingRecord;
  expiresAt: number;
}

/** In-memory utk dev/test (Node single-threaded → check-then-delete aman). */
export class InMemoryPairingStore extends PairingStore {
  private readonly kv = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  async set(codeHash: string, record: PairingRecord, ttlMs: number): Promise<void> {
    this.kv.set(codeHash, { record, expiresAt: this.now() + ttlMs });
  }

  async get(codeHash: string): Promise<PairingRecord | null> {
    const e = this.kv.get(codeHash);
    if (!e) return null;
    if (this.now() > e.expiresAt) {
      this.kv.delete(codeHash);
      return null;
    }
    return e.record;
  }

  async consume(codeHash: string): Promise<PairingRecord | null> {
    const record = await this.get(codeHash);
    if (record) this.kv.delete(codeHash);
    return record;
  }
}
