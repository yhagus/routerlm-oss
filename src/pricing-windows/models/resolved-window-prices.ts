import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import type { WindowPrices } from "./upstream-model-pricing-windows.js";

/** Window Prices with each price left out filled with the standard one (ADR 0038). */
export function resolvedWindowPrices(
  standard: UpstreamModelPrices,
  windowPrices: WindowPrices,
): UpstreamModelPrices {
  return {
    inputPrice: windowPrices.inputPrice ?? standard.inputPrice,
    outputPrice: windowPrices.outputPrice ?? standard.outputPrice,
    cacheReadPrice: windowPrices.cacheReadPrice ?? standard.cacheReadPrice,
    cacheWritePrice: windowPrices.cacheWritePrice ?? standard.cacheWritePrice,
  };
}
