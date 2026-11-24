import { doWindowPricesApplyAt } from "@/pricing-windows/models/pricing-window-activity.js";
import { resolvedWindowPrices } from "@/pricing-windows/models/resolved-window-prices.js";
import { type SnapshotUpstreamModel, standardPricesOf } from "@/snapshot/models/snapshot.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import type { ServiceTier } from "./internal-format.js";

export interface RequestPrices {
  prices: UpstreamModelPrices;
  pricingWindowName: string | null;
}

export function pricesForRequest(
  upstreamModel: SnapshotUpstreamModel,
  tier: ServiceTier | null,
  receivedAt: Date,
): RequestPrices {
  const standard = standardPricesOf(upstreamModel);
  if (tier !== null) {
    return { prices: { ...standard, ...upstreamModel.tierPrices[tier] }, pricingWindowName: null };
  }
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
