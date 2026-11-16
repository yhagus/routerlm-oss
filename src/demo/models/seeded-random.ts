/** A source of numbers in [0, 1), like `Math.random`, but repeatable. */
export type Random = () => number;

const UINT32_RANGE = 2 ** 32;

/** Mulberry32: tiny, fast, and the same sequence for the same seed on every machine. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export interface Weighted<T> {
  value: T;
  weight: number;
}

/** One of `entries`, each as likely as its share of the total weight. */
export function pickWeighted<T>(random: Random, entries: readonly Weighted<T>[]): T {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let remaining = random() * totalWeight;
  for (const entry of entries) {
    remaining -= entry.weight;
    if (remaining < 0) {
      return entry.value;
    }
  }
  const last = entries.at(-1);
  if (last === undefined) {
    throw new Error("pickWeighted needs at least one entry");
  }
  return last.value;
}

/**
 * A positive number around `median`, skewed long like request sizes are:
 * `spread` is the standard deviation of its logarithm.
 */
export function logNormal(random: Random, median: number, spread: number): number {
  // Box-Muller; 1 - random() keeps the logarithm's argument above zero.
  const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return median * Math.exp(spread * gaussian);
}

/** An integer in [min, max]. */
export function between(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
