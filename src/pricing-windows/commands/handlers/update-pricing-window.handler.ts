import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '@/db/schemas/relations';
import {
  pricingWindows,
  providers,
  upstreamModelPricingWindows,
  upstreamModels,
} from '@/db/schemas';
import { UpdatePricingWindowCommand } from '@/pricing-windows/commands/impl/update-pricing-window.command';
import {
  type PricingWindow,
  toPricingWindowWriteError,
} from '@/pricing-windows/models/pricing-window';
import { selectAttachmentsByUpstreamModelId } from '@/pricing-windows/models/upstream-model-pricing-windows';
import { findOverlappingWindowPrices } from '@/pricing-windows/models/window-prices-overlap';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';

@CommandHandler(UpdatePricingWindowCommand)
export class UpdatePricingWindowHandler implements ICommandHandler<UpdatePricingWindowCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ pricingWindowId, changes }: UpdatePricingWindowCommand): Promise<PricingWindow> {
    let updated: PricingWindow | undefined;
    try {
      updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(pricingWindows)
          .set(changes)
          .where(eq(pricingWindows.id, pricingWindowId))
          .returning();
        const isRescheduled = changes.ranges !== undefined || changes.timeZone !== undefined;
        if (row !== undefined && isRescheduled) {
          await this.assertNoOverlapOnAttachingModels(tx, pricingWindowId);
        }
        return row;
      });
    } catch (error) {
      throw toPricingWindowWriteError(error, changes.name);
    }
    if (!updated) {
      throw new NotFoundException('Pricing Window not found');
    }
    await this.snapshot.changed();
    return updated;
  }

  private async assertNoOverlapOnAttachingModels(
    tx: Transaction,
    pricingWindowId: string,
  ): Promise<void> {
    const attachingModelIds = tx
      .select({ id: upstreamModelPricingWindows.upstreamModelId })
      .from(upstreamModelPricingWindows)
      .where(eq(upstreamModelPricingWindows.pricingWindowId, pricingWindowId));
    const attachmentsByUpstreamModelId = await selectAttachmentsByUpstreamModelId(
      tx,
      inArray(upstreamModelPricingWindows.upstreamModelId, attachingModelIds),
    );

    const now = new Date();
    const overlappingModelIds = [...attachmentsByUpstreamModelId]
      .filter(([, modelAttachments]) => findOverlappingWindowPrices(modelAttachments, now))
      .map(([upstreamModelId]) => upstreamModelId);
    if (overlappingModelIds.length === 0) {
      return;
    }

    const overlappingModels = await tx
      .select({ upstreamModelId: upstreamModels.upstreamModelId, providerName: providers.name })
      .from(upstreamModels)
      .innerJoin(providers, eq(providers.id, upstreamModels.providerId))
      .where(inArray(upstreamModels.id, overlappingModelIds))
      .orderBy(asc(upstreamModels.upstreamModelId));
    const modelNames = overlappingModels.map(
      (model) => `${model.upstreamModelId} (${model.providerName})`,
    );
    throw new BadRequestException(
      `Window Prices would overlap on the Upstream Models ${modelNames.join(', ')}, so this Pricing Window's schedule can't change; change their Window Prices first`,
    );
  }
}
