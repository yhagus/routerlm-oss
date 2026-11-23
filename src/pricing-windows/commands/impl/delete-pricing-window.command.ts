import { Command } from "@nestjs/cqrs";

/** Deletes the Pricing Window, and its Window Prices from every Upstream Model. */
export class DeletePricingWindowCommand extends Command<void> {
  constructor(readonly pricingWindowId: string) {
    super();
  }
}
