import { Command } from "@nestjs/cqrs";
import type { PricingWindow } from "@/pricing-windows/models/pricing-window.js";
import type { PricingWindowChanges } from "@/pricing-windows/schemas/pricing-window.schema.js";

/** Renames, reschedules, or enables or disables the Pricing Window; its Window Prices stay. */
export class UpdatePricingWindowCommand extends Command<PricingWindow> {
  constructor(
    readonly pricingWindowId: string,
    readonly changes: PricingWindowChanges,
  ) {
    super();
  }
}
