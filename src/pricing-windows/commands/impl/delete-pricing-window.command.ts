import { Command } from "@nestjs/cqrs";

export class DeletePricingWindowCommand extends Command<void> {
  constructor(readonly pricingWindowId: string) {
    super();
  }
}
