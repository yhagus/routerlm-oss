import { Query } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows";

export class ListUpstreamModelPricingWindowsQuery extends Query<AttachedPricingWindow[]> {
  constructor(readonly upstreamModelId: string) {
    super();
  }
}
