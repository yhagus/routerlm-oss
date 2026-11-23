import { Query } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows.js";

/** The Upstream Model's Pricing Windows with their Window Prices, in its order. */
export class ListUpstreamModelPricingWindowsQuery extends Query<AttachedPricingWindow[]> {
  constructor(readonly upstreamModelId: string) {
    super();
  }
}
