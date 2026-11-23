import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { pricingWindows, upstreamModelPricingWindows, upstreamModels } from "@/db/schemas/index.js";
import { ReplaceUpstreamModelPricingWindowsCommand } from "@/pricing-windows/commands/impl/replace-upstream-model-pricing-windows.command.js";
import {
  type AttachedPricingWindow,
  readPricingWindowsOf,
} from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";

@CommandHandler(ReplaceUpstreamModelPricingWindowsCommand)
export class ReplaceUpstreamModelPricingWindowsHandler implements ICommandHandler<ReplaceUpstreamModelPricingWindowsCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    upstreamModelId,
    entries,
  }: ReplaceUpstreamModelPricingWindowsCommand): Promise<AttachedPricingWindow[]> {
    const replaced = await this.db.transaction(async (tx) => {
      // Locked, so a concurrent Kind change can't slip in between the check and the write.
      const [upstreamModel] = await tx
        .select({ kind: upstreamModels.kind })
        .from(upstreamModels)
        .where(eq(upstreamModels.id, upstreamModelId))
        .for("update");
      if (!upstreamModel) {
        throw new NotFoundException("Upstream Model not found");
      }
      if (upstreamModel.kind !== "chat") {
        throw new BadRequestException(
          `Only a chat Upstream Model has Pricing Windows; this one is of the Kind ${upstreamModel.kind}`,
        );
      }

      const pricingWindowIds = entries.map((entry) => entry.pricingWindowId);
      if (pricingWindowIds.length > 0) {
        // Locked, so none is deleted before the new links reference it.
        const found = await tx
          .select({ id: pricingWindows.id })
          .from(pricingWindows)
          .where(inArray(pricingWindows.id, pricingWindowIds))
          .for("share");
        if (found.length !== pricingWindowIds.length) {
          throw new NotFoundException("Pricing Window not found");
        }
      }

      await tx
        .delete(upstreamModelPricingWindows)
        .where(eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId));
      if (entries.length > 0) {
        await tx.insert(upstreamModelPricingWindows).values(
          entries.map((entry, position) => ({
            upstreamModelId,
            pricingWindowId: entry.pricingWindowId,
            position,
            inputPrice: entry.inputPrice ?? null,
            outputPrice: entry.outputPrice ?? null,
            cacheReadPrice: entry.cacheReadPrice ?? null,
            cacheWritePrice: entry.cacheWritePrice ?? null,
          })),
        );
      }
      return readPricingWindowsOf(tx, upstreamModelId);
    });
    await this.snapshot.changed();
    return replaced;
  }
}
