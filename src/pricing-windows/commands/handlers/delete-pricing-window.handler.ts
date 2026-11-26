import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { pricingWindows } from '@/db/schemas';
import { DeletePricingWindowCommand } from '@/pricing-windows/commands/impl/delete-pricing-window.command';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';

@CommandHandler(DeletePricingWindowCommand)
export class DeletePricingWindowHandler implements ICommandHandler<DeletePricingWindowCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ pricingWindowId }: DeletePricingWindowCommand): Promise<void> {
    const deleted = await this.db
      .delete(pricingWindows)
      .where(eq(pricingWindows.id, pricingWindowId))
      .returning({ id: pricingWindows.id });
    if (deleted.length === 0) {
      throw new NotFoundException('Pricing Window not found');
    }
    await this.snapshot.changed();
  }
}
