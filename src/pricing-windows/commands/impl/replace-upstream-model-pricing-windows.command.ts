import { Command } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import type { WindowPricesEntry } from "@/pricing-windows/schemas/pricing-window.schema.js";

export class ReplaceUpstreamModelPricingWindowsCommand extends Command<AttachedPricingWindow[]> {
  constructor(
    readonly upstreamModelId: string,
    readonly entries: WindowPricesEntry[],
  ) {
    super();
  }
}
