import { Command } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import type { WindowPricesEntry } from "@/pricing-windows/schemas/pricing-window.schema.js";

/**
 * Replaces the chat Upstream Model's whole ordered list of Pricing Windows and
 * their Window Prices, so attaching, detaching and reordering are one write.
 */
export class ReplaceUpstreamModelPricingWindowsCommand extends Command<AttachedPricingWindow[]> {
  constructor(
    readonly upstreamModelId: string,
    readonly entries: WindowPricesEntry[],
  ) {
    super();
  }
}
