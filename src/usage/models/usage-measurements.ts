import type { TokenUsage } from "@/inference/models/internal-format.js";
import type { ServedBy, UpstreamModelPrices } from "./usage-job.js";

/** The token counts, Cost and incomplete flag a Usage Log stores. */
export interface UsageMeasurements extends TokenUsage {
  /** USD. Null when nothing was served, or tokens were used at a price nobody entered. */
  cost: number | null;
  isIncomplete: boolean;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

const NOT_REPORTED: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};

/**
 * What a Usage Log records about tokens and Cost, from the usage the upstream
 * reported and the prices the Upstream Model had at request time. Counts the
 * upstream didn't report stay null and flag the record incomplete; nothing is
 * estimated, so the Cost then covers only the reported counts.
 */
export function usageMeasurementsOf(
  servedBy: ServedBy | null,
  usage: TokenUsage | null,
): UsageMeasurements {
  if (!servedBy) {
    return { ...NOT_REPORTED, cost: null, isIncomplete: false };
  }
  const reported = usage ?? NOT_REPORTED;
  const pricedCounts = pricedCountsOf(reported, servedBy.prices);
  // Reasoning tokens are part of the output count, so missing them loses nothing billed.
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
