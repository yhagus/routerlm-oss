import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import { pricingWindows } from "@/db/schemas/index.js";
import { CreatePricingWindowCommand } from "@/pricing-windows/commands/impl/create-pricing-window.command.js";
import {
  type PricingWindow,
  toPricingWindowWriteError,
} from "@/pricing-windows/models/pricing-window.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";

@CommandHandler(CreatePricingWindowCommand)
export class CreatePricingWindowHandler implements ICommandHandler<CreatePricingWindowCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newPricingWindow }: CreatePricingWindowCommand): Promise<PricingWindow> {
    let created: PricingWindow;
    try {
      [created] = await this.db.insert(pricingWindows).values(newPricingWindow).returning();
    } catch (error) {
      throw toPricingWindowWriteError(error, newPricingWindow.name);
    }
    await this.snapshot.changed();
    return created;
  }
}
