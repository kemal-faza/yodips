import type { CapturedSession } from './session-contract';

/**
 * Storage-neutral view of one stored session record.
 *
 * `expiresAt` is the adapter-local absolute wall-clock expiry of the sliding
 * TTL (the Map adapter owns one). It is OMITTED by storages that enforce the
 * sliding TTL natively (Redis EXPIRE): for those, a live GET means the record
 * is still within its TTL, so the policy must not re-check a local expiry.
 */
export interface SessionRecord {
  session: CapturedSession;
  expiresAt?: number;
}

/** Inputs of one policy evaluation. */
export interface SessionRecordPolicyOpts {
  /** Sliding TTL in ms. A live read's new record expiry is `now + ttlMs`. */
  ttlMs: number;
  /**
   * Absolute lifetime cap in ms. `undefined`, `0`, or a negative value disables
   * the cap (legacy sliding-only behavior).
   */
  absoluteMs?: number;
  /**
   * Exact `sessionGeneration` the caller is qualified by. Omit for a
   * generation-agnostic read (`get()`); when present, a record carrying a
   * different generation is `generation-mismatch` and is NEVER slid.
   */
  generation?: string;
}

/**
 * One ordered decision for a session record. The adapter maps it to storage
 * operations; the decision itself performs no I/O and touches no clock.
 *
 * Ordering (MUST stay identical across adapters):
 *   absent → sliding-expired → absolute-dead → generation compare → live.
 *
 * `slide: true` means a read-style access MUST extend the record's TTL to
 * `expiresAt`; a compare-and-clear maps `live` to a delete instead and ignores
 * the slide.
 */
export type SessionRecordDecision =
  | { kind: 'absent'; slide: false }
  | { kind: 'expired'; slide: false }
  | { kind: 'absolute-dead'; slide: false }
  | { kind: 'generation-mismatch'; slide: false }
  | { kind: 'live'; session: CapturedSession; slide: true; expiresAt: number };

/**
 * The ONE session-record policy: decide what a stored record means at `now`
 * given the sliding TTL, the optional absolute cap, and the caller's exact
 * session generation. Dependency-free and side-effect-free — every adapter
 * (Map, Redis + Lua CAS) keeps only its storage-specific I/O.
 *
 * `absoluteMs` is evaluated BEFORE the generation compare: a capturedAt-dead
 * record is dead (and cleaned up by the caller) even when the caller's
 * generation differs, preserving the historical `clearIfGeneration`/`get`
 * parity. The generation compare is skipped entirely when `opts.generation` is
 * omitted (the generation-agnostic `get()` path).
 */
export function evaluateRecord(
  record: SessionRecord | null,
  now: number,
  opts: SessionRecordPolicyOpts,
): SessionRecordDecision {
  if (!record) return { kind: 'absent', slide: false };
  if (record.expiresAt !== undefined && now > record.expiresAt) {
    return { kind: 'expired', slide: false };
  }
  const absoluteMs =
    opts.absoluteMs !== undefined && opts.absoluteMs > 0
      ? opts.absoluteMs
      : undefined;
  if (absoluteMs !== undefined && now - record.session.capturedAt >= absoluteMs) {
    return { kind: 'absolute-dead', slide: false };
  }
  if (
    opts.generation !== undefined &&
    record.session.sessionGeneration !== opts.generation
  ) {
    return { kind: 'generation-mismatch', slide: false };
  }
  return { kind: 'live', session: record.session, slide: true, expiresAt: now + opts.ttlMs };
}
