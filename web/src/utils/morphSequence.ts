export type Rng = () => number;

/** Fisher-Yates shuffle on a copy (never mutates input). */
export function shuffle<T>(arr: ReadonlyArray<T>, rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deck-shuffle "per interval" index picker. With randomize=true it owns a deck
 * (a permutation of 0..count-1) and walks it once per interval, reshuffling on
 * exhaustion so every index appears exactly once per interval. A wrap-guard
 * keeps the first deck element of a new interval from repeating the current
 * index. count<=1 always returns 0.
 */
export function createIntervalShuffler(
  count: number,
  rng: Rng = Math.random,
  randomize = true,
): (current: number) => number {
  if (count <= 1) return () => 0;
  if (!randomize) return (current) => (current + 1) % count;

  let deck: number[] = [];
  let ptr = 0;

  function fill(): void {
    deck = shuffle(Array.from({ length: count }, (_unused, i) => i), rng);
    ptr = 0;
  }

  function next(current: number): number {
    if (ptr >= deck.length) {
      do {
        fill();
      } while (deck[0] === current);
    }
    return deck[ptr++];
  }

  return next;
}