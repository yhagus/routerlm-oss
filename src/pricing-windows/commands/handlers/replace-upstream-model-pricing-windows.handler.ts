import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { pricingWindows, upstreamModelPricingWindows, upstreamModels } from '@/db/schemas';
import { ReplaceUpstreamModelPricingWindowsCommand } from '@/pricing-windows/commands/impl/replace-upstream-model-pricing-windows.command';
import {
  type AttachedPricingWindow,
  readPricingWindowsOf,
} from '@/pricing-windows/models/upstream-model-pricing-windows';
import { describeValidityPeriod } from '@/pricing-windows/models/validity-period';
import {
  findOverlappingWindowPrices,
  type WindowPricesTiming,
} from '@/pricing-windows/models/window-prices-overlap';
import type { WindowPricesEntry } from '@/pricing-windows/schemas/pricing-window.schema';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';

type NamedWindowHours = Pick<WindowPricesTiming, 'timeZone' | 'ranges'> & { name: string };
type NamedWindowPricesTiming = WindowPricesTiming & { name: string };

function assertNoOverlap(
  entries: readonly WindowPricesEntry[],
  windowsById: ReadonlyMap<string, NamedWindowHours>,
): void {
  const timedEntries = entries.flatMap((entry): NamedWindowPricesTiming[] => {
    const window = windowsById.get(entry.pricingWindowId);
    if (window === undefined) {
      return [];
    }
    return [
      { ...window, validFrom: entry.validFrom ?? null, validUntil: entry.validUntil ?? null },
    ];
  });
  const overlap = findOverlappingWindowPrices(timedEntries, new Date());
  if (overlap !== undefined) {
    const [first, second] = overlap;
    throw new BadRequestException(
      `The Window Prices for ${describeEntry(first)} and ${describeEntry(second)} can apply at the same moment; only one may apply at a time`,
    );
  }
}

function describeEntry(entry: NamedWindowPricesTiming): string {
  const period = describeValidityPeriod(entry);
  return period === '' ? `"${entry.name}"` : `"${entry.name}" (${period})`;
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
      const [upstreamModel] = await tx
        .select({ kind: upstreamModels.kind })
        .from(upstreamModels)
        .where(eq(upstreamModels.id, upstreamModelId))
        .for('update');
      if (!upstreamModel) {
        throw new NotFoundException('Upstream Model not found');
      }
      if (upstreamModel.kind !== 'chat') {
        throw new BadRequestException(
          `Only a chat Upstream Model has Pricing Windows; this one is of the Kind ${upstreamModel.kind}`,
        );
      }

      const pricingWindowIds = [...new Set(entries.map((entry) => entry.pricingWindowId))];
      if (pricingWindowIds.length > 0) {
        const found = await tx
          .select({
            id: pricingWindows.id,
            name: pricingWindows.name,
            timeZone: pricingWindows.timeZone,
            ranges: pricingWindows.ranges,
          })
          .from(pricingWindows)
          .where(inArray(pricingWindows.id, pricingWindowIds))
          .for('share');
        if (found.length !== pricingWindowIds.length) {
          throw new NotFoundException('Pricing Window not found');
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
