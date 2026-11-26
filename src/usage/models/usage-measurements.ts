import type { TokenUsage } from '@/inference/models/internal-format';
import type {
  MediaUnits,
  ServedBy,
  UpstreamModelPrices,
  UpstreamModelUnitPrices,
} from './usage-job';

export interface UsageMeasurements extends TokenUsage {
  cost: number | null;
  isIncomplete: boolean;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;
const CHARACTERS_PER_PRICE_UNIT = 1_000_000;

const NOT_REPORTED: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};

export function usageMeasurementsOf(
  servedBy: Pick<ServedBy, 'prices'> | null,
  usage: TokenUsage | null,
): UsageMeasurements {
  if (!servedBy) {
    return { ...NOT_REPORTED, cost: null, isIncomplete: false };
  }
  const reported = usage ?? NOT_REPORTED;
  const pricedCounts = pricedCountsOf(reported, servedBy.prices);
  const isIncomplete = pricedCounts.some(({ tokens }) => tokens === null);
  return { ...reported, cost: costOf(pricedCounts, usage !== null), isIncomplete };
}

interface PricedCount {
  tokens: number | null;
  pricePerMillion: number | null;
}

function pricedCountsOf(usage: TokenUsage, prices: UpstreamModelPrices): PricedCount[] {
  return [
    { tokens: usage.inputTokens, pricePerMillion: prices.inputPrice },
    { tokens: usage.outputTokens, pricePerMillion: prices.outputPrice },
    { tokens: usage.cacheReadTokens, pricePerMillion: prices.cacheReadPrice },
    { tokens: usage.cacheWriteTokens, pricePerMillion: prices.cacheWritePrice },
  ];
}

function costOf(pricedCounts: PricedCount[], wasReported: boolean): number | null {
  if (!wasReported) {
    return null;
  }
  let cost = 0;
  for (const { tokens, pricePerMillion } of pricedCounts) {
    if (!tokens) {
      continue;
    }
    if (pricePerMillion === null) {
      return null;
    }
    cost += (tokens * pricePerMillion) / TOKENS_PER_PRICE_UNIT;
  }
  return cost;
}

function perUnit(price: number | null, per: number): number | null {
  return price === null ? null : price / per;
}

export function unitCostOf(
  servedBy: Pick<ServedBy, 'unitPrices'> | null,
  units: MediaUnits,
): number | null {
  const prices = servedBy?.unitPrices;
  if (!prices) {
    return null;
  }
  const imagePrice =
    (units.tier === undefined ? undefined : prices.pricePerImageBySize?.[units.tier]) ??
    prices.pricePerImage;
  const pricedCounts = [
    { count: units.imagesOut ?? 0, price: imagePrice },
    { count: units.imagesIn ?? 0, price: prices.pricePerInputImage },
    { count: units.outputSeconds ?? 0, price: secondPriceOf(prices, units.tier) },
    {
      count: units.characters ?? 0,
      price: perUnit(prices.pricePerMillionCharacters, CHARACTERS_PER_PRICE_UNIT),
    },
    { count: units.audioSeconds ?? 0, price: prices.pricePerAudioSecond },
  ];
  let cost = 0;
  for (const { count, price } of pricedCounts) {
    if (count === 0) {
      continue;
    }
    if (price === null) {
      return null;
    }
    cost += count * price;
  }
  return cost;
}

function secondPriceOf(prices: UpstreamModelUnitPrices, tier: string | undefined): number | null {
  if (tier === undefined) {
    return null;
  }
  return prices.pricePerSecondByResolution?.[tier] ?? null;
}
