export type Random = () => number;

const UINT32_RANGE = 2 ** 32;

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

export function logNormal(random: Random, median: number, spread: number): number {
  const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return median * Math.exp(spread * gaussian);
}

export function between(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
