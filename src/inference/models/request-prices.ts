import { isPricingWindowActiveAt } from "@/pricing-windows/models/pricing-window-activity.js";
import { resolvedWindowPrices } from "@/pricing-windows/models/resolved-window-prices.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import type { ServiceTier } from "./internal-format.js";

/** The prices a request's Cost comes from, and the Pricing Window they came from. */
export interface RequestPrices {
  prices: UpstreamModelPrices;
  /** Null unless a Pricing Window priced the request. */
  pricingWindowName: string | null;
}

/**
 * The Upstream Model's prices for a request received at `receivedAt` and
 * served at `tier` (ADR 0038). The first rule that matches applies:
 * 1. a tier served it: the tier's prices, standard for the rest; windows are ignored;
 * 2. a Pricing Window is active: the first one's Window Prices, standard for the rest;
 * 3. otherwise the standard prices.
 */
export function pricesForRequest(
  upstreamModel: SnapshotUpstreamModel,
  tier: ServiceTier | null,
  receivedAt: Date,
): RequestPrices {
  const { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice } = upstreamModel;
  const standard = { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice };
  if (tier !== null) {
    return { prices: { ...standard, ...upstreamModel.tierPrices[tier] }, pricingWindowName: null };
  }
  // Windows come in the model's order: the first active one wins.
  const activeWindow = upstreamModel.pricingWindows.find((window) =>
    isPricingWindowActiveAt(window, receivedAt),
  );
  if (activeWindow === undefined) {
    return { prices: standard, pricingWindowName: null };
  }
  return {
    prices: resolvedWindowPrices(standard, activeWindow.windowPrices),
    pricingWindowName: activeWindow.name,
  };
}
