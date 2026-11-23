import { doWindowPricesApplyAt } from "@/pricing-windows/models/pricing-window-activity.js";
import { resolvedWindowPrices } from "@/pricing-windows/models/resolved-window-prices.js";
import { type SnapshotUpstreamModel, standardPricesOf } from "@/snapshot/models/snapshot.js";
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
 * 2. Window Prices apply (their window is active, inside their Validity
 *    Period): those, standard for the rest;
 * 3. otherwise the standard prices.
 */
export function pricesForRequest(
  upstreamModel: SnapshotUpstreamModel,
  tier: ServiceTier | null,
  receivedAt: Date,
): RequestPrices {
  const standard = standardPricesOf(upstreamModel);
  if (tier !== null) {
    return { prices: { ...standard, ...upstreamModel.tierPrices[tier] }, pricingWindowName: null };
  }
  // At most one applies: a model's Window Prices never overlap (ADR 0040).
  const applyingWindow = upstreamModel.pricingWindows.find((window) =>
    doWindowPricesApplyAt(window, receivedAt),
  );
  if (applyingWindow === undefined) {
    return { prices: standard, pricingWindowName: null };
  }
  return {
    prices: resolvedWindowPrices(standard, applyingWindow.windowPrices),
    pricingWindowName: applyingWindow.name,
  };
}
