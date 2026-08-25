export interface PairingRecord {
  /** Identitas pemilik sesi sumber (NIM, dari JWT guard — bukan dari client). */
  sub: string;
  /** Epoch ms kedaluwarsa (informasional; TTL efektif di tiap implementasi). */
  expiresAt: number;
}

/**
 * Hasil consume yang MEMBEDAKAN expired dari invalid. Tradeoff sadar: attacker
 * bisa membedakan "kode pernah ada" — tidak feasible dieksploitasi (kode 8 char
 * Crockford + throttle 5/min), dan UX menuntut pesan kadaluwarsa yang jelas.
 */
export type PairingConsumeResult =
  | { status: 'consumed'; record: PairingRecord }
  | { status: 'expired' }
  | { status: 'invalid' };

/**
 * Store kode pairing sekali-pakai, keyed by sha256(kode).
 * Pola ala SessionStore/NotificationStore: InMemory dev/test, Redis prod.
 */
export abstract class PairingStore {
  abstract set(codeHash: string, record: PairingRecord, ttlMs: number): Promise<void>;
  abstract get(codeHash: string): Promise<PairingRecord | null>;
  /** Ambil sekaligus HAPUS atomik; bedakan expired vs invalid. */
  abstract consume(codeHash: string): Promise<PairingConsumeResult>;
}

interface Entry {
  record: PairingRecord;
  expiresAt: number;
}

/** Batas entri mati di memori sebelum sweep dipicu (dev-only store). */
const INMEMORY_SWEEP_THRESHOLD = 500;

/** In-memory utk dev/test (Node single-threaded → check-then-delete aman). */
export class InMemoryPairingStore extends PairingStore {
  private readonly kv = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  async set(codeHash: string, record: PairingRecord, ttlMs: number): Promise<void> {
    if (this.kv.size >= INMEMORY_SWEEP_THRESHOLD) this.sweepExpired();
    this.kv.set(codeHash, { record, expiresAt: this.now() + ttlMs });
  }

  async get(codeHash: string): Promise<PairingRecord | null> {
    const e = this.kv.get(codeHash);
    if (!e) return null;
    if (this.now() > e.expiresAt) return null;
    return e.record;
  }

  async consume(codeHash: string): Promise<PairingConsumeResult> {
    const e = this.kv.get(codeHash);
    if (!e) return { status: 'invalid' };
    this.kv.delete(codeHash);
    if (this.now() > e.expiresAt) return { status: 'expired' };
    return { status: 'consumed', record: e.record };
  }

  private sweepExpired(): void {
    const t = this.now();
    for (const [k, e] of this.kv) if (t > e.expiresAt) this.kv.delete(k);
  }
}
