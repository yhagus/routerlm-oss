import { Command } from "@nestjs/cqrs";
import type { PricingWindow } from "@/pricing-windows/models/pricing-window.js";
import type { NewPricingWindow } from "@/pricing-windows/schemas/pricing-window.schema.js";

export class CreatePricingWindowCommand extends Command<PricingWindow> {
  constructor(readonly newPricingWindow: NewPricingWindow) {
    super();
  }
}
