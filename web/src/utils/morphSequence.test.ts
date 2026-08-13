import { describe, expect, it } from 'vitest';
import { shuffle, createIntervalShuffler } from './morphSequence';

// Deterministic rng sequence.
function makeSeq(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

describe('shuffle', () => {
  it('returns a permutation (all elements, same length) preserving a copy', () => {
    const src = [0, 1, 2, 3];
    const out = shuffle(src, makeSeq(0, 0.5, 0.99));
    expect([...out].sort()).toEqual([...src]);
    expect(out).toHaveLength(src.length);
    expect(src).toEqual([0, 1, 2, 3]); // original untouched
  });
  it('defaults to Math.random when rng omitted', () => {
    const out = shuffle([1, 2, 3]);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });
});

describe('createIntervalShuffler', () => {
  it('walks every index exactly once per interval before reshuffling', () => {
    // rng=0.99 always → Fisher-Yates all no-ops → deck [0,1,2]. Sort is
    // permutation-agnostic so assertion holds for any deck.
    const rng = makeSeq(0.99, 0.99, 0.99);
    const next = createIntervalShuffler(3, rng, true);
    const seenFirst = [next(-1), next(0), next(1)];
    expect([...seenFirst].sort()).toEqual([0, 1, 2]);
    const seenSecond = [next(2), next(0), next(1)];
    expect([...seenSecond].sort()).toEqual([0, 1, 2]);
  });
  it('never returns the current index on wrap (guard)', () => {
    // count=2, rng (0,0.99,0,0.99) → first shuffle [1,0], walk 1 then 0.
    const rng = makeSeq(0, 0.99, 0, 0.99);
    const next = createIntervalShuffler(2, rng, true);
    const a = next(0);
    const b = next(a);
    expect(b).not.toBe(a);
  });
  it('returns 0 for count <= 1 (no infinite loop, no NaN)', () => {
    const next = createIntervalShuffler(1, Math.random, true);
    expect(next(0)).toBe(0);
    expect(next(0)).toBe(0);
    const next0 = createIntervalShuffler(0, Math.random, true);
    expect(next0(-1)).toBe(0);
  });
  it('walks sequentially when randomize=false', () => {
    const next = createIntervalShuffler(3, undefined, false);
    expect(next(0)).toBe(1);
    expect(next(1)).toBe(2);
    expect(next(2)).toBe(0);
  });
});