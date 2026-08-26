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
  /**
   * Sub pemilik kode yang SUDAH dikonsumsi (tombstone), atau null.
   * Dipakai endpoint status agar web bisa tahu "kode sudah terpakai"
   * tanpa bisa membedakan kode milik orang lain (anti-oracle: selalu
   * bandingkan dengan viewerSub di layer service).
   */
  abstract findConsumed(codeHash: string): Promise<string | null>;
}

interface Entry {
  record: PairingRecord;
  expiresAt: number;
}

/** Batas entri mati di memori sebelum sweep dipicu (dev-only store). */
const INMEMORY_SWEEP_THRESHOLD = 500;

/** TTL tombstone consumed di memori — cukup utk jendela polling web. */
const CONSUMED_TOMBSTONE_TTL_MS = 600_000;

/** In-memory utk dev/test (Node single-threaded → check-then-delete aman). */
export class InMemoryPairingStore extends PairingStore {
  private readonly kv = new Map<string, Entry>();
  private readonly consumed = new Map<string, { sub: string; expiresAt: number }>();

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
    // Tombstone utk status polling: sub pemilik, TTL tetap meski record hilang.
    this.consumed.set(codeHash, {
      sub: e.record.sub,
      expiresAt: this.now() + CONSUMED_TOMBSTONE_TTL_MS,
    });
    return { status: 'consumed', record: e.record };
  }

  async findConsumed(codeHash: string): Promise<string | null> {
    const c = this.consumed.get(codeHash);
    if (!c) return null;
    if (this.now() > c.expiresAt) {
      this.consumed.delete(codeHash);
      return null;
    }
    return c.sub;
  }

  private sweepExpired(): void {
    const t = this.now();
    for (const [k, e] of this.kv) if (t > e.expiresAt) this.kv.delete(k);
    for (const [k, c] of this.consumed) if (t > c.expiresAt) this.consumed.delete(k);
  }
}
