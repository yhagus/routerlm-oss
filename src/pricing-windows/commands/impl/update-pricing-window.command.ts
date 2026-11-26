import { Command } from "@nestjs/cqrs";
import type { PricingWindow } from "@/pricing-windows/models/pricing-window";
import type { PricingWindowChanges } from "@/pricing-windows/schemas/pricing-window.schema";

export class UpdatePricingWindowCommand extends Command<PricingWindow> {
  constructor(
    readonly pricingWindowId: string,
    readonly changes: PricingWindowChanges,
  ) {
    super();
  }
}
