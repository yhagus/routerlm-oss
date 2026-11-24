import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";

export function resolvedWindowPrices(
  standard: UpstreamModelPrices,
  windowPrices: UpstreamModelPrices,
): UpstreamModelPrices {
  return {
    inputPrice: windowPrices.inputPrice ?? standard.inputPrice,
    outputPrice: windowPrices.outputPrice ?? standard.outputPrice,
    cacheReadPrice: windowPrices.cacheReadPrice ?? standard.cacheReadPrice,
    cacheWritePrice: windowPrices.cacheWritePrice ?? standard.cacheWritePrice,
  };
}
