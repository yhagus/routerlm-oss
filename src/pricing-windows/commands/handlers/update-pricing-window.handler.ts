import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { pricingWindows } from "@/db/schemas/index.js";
import { UpdatePricingWindowCommand } from "@/pricing-windows/commands/impl/update-pricing-window.command.js";
import {
  type PricingWindow,
  toPricingWindowWriteError,
} from "@/pricing-windows/models/pricing-window.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";

@CommandHandler(UpdatePricingWindowCommand)
export class UpdatePricingWindowHandler implements ICommandHandler<UpdatePricingWindowCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ pricingWindowId, changes }: UpdatePricingWindowCommand): Promise<PricingWindow> {
    let updated: PricingWindow | undefined;
    try {
      [updated] = await this.db
        .update(pricingWindows)
        .set(changes)
        .where(eq(pricingWindows.id, pricingWindowId))
        .returning();
    } catch (error) {
      throw toPricingWindowWriteError(error, changes.name);
    }
    if (!updated) {
      throw new NotFoundException("Pricing Window not found");
    }
    await this.snapshot.changed();
    return updated;
  }
}
