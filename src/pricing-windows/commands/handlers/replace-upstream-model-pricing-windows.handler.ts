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
import { describeValidityPeriod } from "@/pricing-windows/models/validity-period.js";
import {
  findOverlappingWindowPrices,
  type WindowPricesTiming,
} from "@/pricing-windows/models/window-prices-overlap.js";
import type { WindowPricesEntry } from "@/pricing-windows/schemas/pricing-window.schema.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";

type ScheduledWindow = Pick<WindowPricesTiming, "timeZone" | "ranges"> & { name: string };
type ScheduledEntry = WindowPricesTiming & { name: string };

/** Refuses entries of which two could apply at the same moment (ADR 0040). */
function assertNoOverlap(
  entries: readonly WindowPricesEntry[],
  windowsById: ReadonlyMap<string, ScheduledWindow>,
): void {
  const scheduledEntries = entries.flatMap((entry): ScheduledEntry[] => {
    const window = windowsById.get(entry.pricingWindowId);
    if (window === undefined) {
      return [];
    }
    return [
      { ...window, validFrom: entry.validFrom ?? null, validUntil: entry.validUntil ?? null },
    ];
  });
  const overlap = findOverlappingWindowPrices(scheduledEntries, new Date());
  if (overlap !== undefined) {
    const [first, second] = overlap;
    throw new BadRequestException(
      `The Window Prices for ${describeEntry(first)} and ${describeEntry(second)} can apply at the same moment; only one may apply at a time`,
    );
  }
}

/** `"Whole Week" (from 2026-12-01 00:00 until 2027-01-01 00:00)`, or just the quoted name with no period. */
function describeEntry(entry: ScheduledEntry): string {
  const period = describeValidityPeriod(entry);
  return period === "" ? `"${entry.name}"` : `"${entry.name}" (${period})`;
}

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

      const pricingWindowIds = [...new Set(entries.map((entry) => entry.pricingWindowId))];
      if (pricingWindowIds.length > 0) {
        // Locked, so none is deleted or rescheduled before the new links reference it.
        const found = await tx
          .select({
            id: pricingWindows.id,
            name: pricingWindows.name,
            timeZone: pricingWindows.timeZone,
            ranges: pricingWindows.ranges,
          })
          .from(pricingWindows)
          .where(inArray(pricingWindows.id, pricingWindowIds))
          .for("share");
        if (found.length !== pricingWindowIds.length) {
          throw new NotFoundException("Pricing Window not found");
        }
        assertNoOverlap(entries, new Map(found.map((window) => [window.id, window])));
      }

      await tx
        .delete(upstreamModelPricingWindows)
        .where(eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId));
      if (entries.length > 0) {
        await tx.insert(upstreamModelPricingWindows).values(
          entries.map((entry) => ({
            upstreamModelId,
            pricingWindowId: entry.pricingWindowId,
            inputPrice: entry.inputPrice ?? null,
            outputPrice: entry.outputPrice ?? null,
            cacheReadPrice: entry.cacheReadPrice ?? null,
            cacheWritePrice: entry.cacheWritePrice ?? null,
            validFrom: entry.validFrom ?? null,
            validUntil: entry.validUntil ?? null,
          })),
        );
      }
      return readPricingWindowsOf(tx, upstreamModelId);
    });
    await this.snapshot.changed();
    return replaced;
  }
}
