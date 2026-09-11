import {
  evaluateRecord,
  type SessionRecord,
} from './session-record-policy';
import type { CapturedSession } from './session-contract';

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);

function makeCaptured(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    identity: 'U1',
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=A',
    siapCookie: '',
    capturedAt: 1_000,
    sessionGeneration: GEN_A,
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<CapturedSession> = {},
  expiresAt?: number,
): SessionRecord {
  return { session: makeCaptured(overrides), expiresAt };
}

const TTL = 500;

describe('evaluateRecord (one session-record policy core)', () => {
  it('absent: a null record is absent regardless of the requested generation', () => {
    const decision = evaluateRecord(null, 2_000, {
      ttlMs: TTL,
      generation: GEN_A,
    });
    expect(decision).toEqual({ kind: 'absent', slide: false });
  });

  it('expired: a record past its sliding expiresAt is expired', () => {
    const decision = evaluateRecord(makeRecord({}, 1_999), 2_000, {
      ttlMs: TTL,
      generation: GEN_A,
    });
    expect(decision).toEqual({ kind: 'expired', slide: false });
  });

  it('expired boundary: now === expiresAt is NOT expired (strict >)', () => {
    const decision = evaluateRecord(makeRecord({}, 2_000), 2_000, {
      ttlMs: TTL,
      generation: GEN_A,
    });
    expect(decision.kind).toBe('live');
  });

  it('live: a sliding-fresh record slides and returns the session', () => {
    const session = makeCaptured();
    const decision = evaluateRecord({ session, expiresAt: 5_000 }, 2_000, {
      ttlMs: TTL,
      generation: GEN_A,
    });
    expect(decision).toEqual({
      kind: 'live',
      session,
      slide: true,
      expiresAt: 2_000 + TTL,
    });
  });

  it('ordering: expired beats absolute-dead (sliding check runs first)', () => {
    // Past BOTH the sliding expiry and the absolute cap, with a mismatched gen.
    const decision = evaluateRecord(makeRecord({ capturedAt: 0 }, 1_999), 2_000, {
      ttlMs: TTL,
      absoluteMs: 100,
      generation: GEN_B,
    });
    expect(decision).toEqual({ kind: 'expired', slide: false });
  });

  it('absolute-dead: past the absolute cap even while the sliding TTL is fresh', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 0 }, 5_000), 200, {
      ttlMs: TTL,
      absoluteMs: 200,
      generation: GEN_A,
    });
    expect(decision).toEqual({ kind: 'absolute-dead', slide: false });
  });

  it('absolute boundary: now - capturedAt === absoluteMs is dead (>=)', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 1_000 }, 9_000), 1_200, {
      ttlMs: TTL,
      absoluteMs: 200,
      generation: GEN_A,
    });
    expect(decision).toEqual({ kind: 'absolute-dead', slide: false });
  });

  it('absolute cap: within the cap by one ms is live', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 1_000 }, 9_000), 1_199, {
      ttlMs: TTL,
      absoluteMs: 200,
      generation: GEN_A,
    });
    expect(decision.kind).toBe('live');
  });

  it('ordering: absolute-dead beats generation-mismatch (absolute before gen compare)', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 0 }, 9_000), 500, {
      ttlMs: TTL,
      absoluteMs: 200,
      generation: GEN_B, // mismatched, but absolute-dead wins
    });
    expect(decision).toEqual({ kind: 'absolute-dead', slide: false });
  });

  it('generation-mismatch: sliding-live, within the absolute cap, different generation', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 1_000 }, 9_000), 1_100, {
      ttlMs: TTL,
      generation: GEN_B,
    });
    expect(decision).toEqual({ kind: 'generation-mismatch', slide: false });
  });

  it('generation-mismatch: a legacy record without a generation never matches', () => {
    const decision = evaluateRecord(
      makeRecord({ sessionGeneration: undefined as unknown as string }, 9_000),
      1_100,
      { ttlMs: TTL, generation: GEN_A },
    );
    expect(decision).toEqual({ kind: 'generation-mismatch', slide: false });
  });

  it('generation omitted (generation-agnostic get): any sliding-fresh record is live', () => {
    const session = makeCaptured({ sessionGeneration: GEN_B });
    const decision = evaluateRecord({ session, expiresAt: 9_000 }, 1_100, {
      ttlMs: TTL,
    });
    expect(decision).toEqual({
      kind: 'live',
      session,
      slide: true,
      expiresAt: 1_100 + TTL,
    });
  });

  it('absolute cap disabled when absoluteMs is undefined: an ancient capture stays live', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 0 }, 2_000_000), 1_000_000, {
      ttlMs: TTL,
    });
    expect(decision.kind).toBe('live');
  });

  it('absolute cap normalizes 0/negative to disabled', () => {
    const record = makeRecord({ capturedAt: 0 }, 2_000_000);
    expect(evaluateRecord(record, 1_000_000, { ttlMs: TTL, absoluteMs: 0 }).kind).toBe('live');
    expect(evaluateRecord(record, 1_000_000, { ttlMs: TTL, absoluteMs: -5 }).kind).toBe('live');
  });

  it('storage-neutral: a record without expiresAt (Redis TTL enforced natively) is live on match', () => {
    const session = makeCaptured();
    const decision = evaluateRecord({ session }, 7_777, {
      ttlMs: TTL,
      generation: GEN_A,
    });
    expect(decision).toEqual({
      kind: 'live',
      session,
      slide: true,
      expiresAt: 7_777 + TTL,
    });
  });

  it('storage-neutral: a record without expiresAt can still be absolute-dead', () => {
    const decision = evaluateRecord(makeRecord({ capturedAt: 0 }), 500, {
      ttlMs: TTL,
      absoluteMs: 200,
      generation: GEN_A,
    });
    expect(decision).toEqual({ kind: 'absolute-dead', slide: false });
  });

  it('never mutates the record it is given', () => {
    const record = makeRecord({}, 5_000);
    const before = JSON.stringify(record);
    evaluateRecord(record, 1_000, { ttlMs: TTL, generation: GEN_A });
    expect(JSON.stringify(record)).toBe(before);
  });
});
