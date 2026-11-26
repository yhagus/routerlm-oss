import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, countDistinct, eq, getColumns } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { pricingWindows, upstreamModelPricingWindows } from '@/db/schemas';
import type { PricingWindowSummary } from '@/pricing-windows/models/pricing-window';
import { isPricingWindowActiveAt } from '@/pricing-windows/models/pricing-window-activity';
import { ListPricingWindowsQuery } from '@/pricing-windows/queries/impl/list-pricing-windows.query';

@QueryHandler(ListPricingWindowsQuery)
export class ListPricingWindowsHandler implements IQueryHandler<ListPricingWindowsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute(): Promise<PricingWindowSummary[]> {
    const rows = await this.db
      .select({
        ...getColumns(pricingWindows),
        attachedUpstreamModelCount: countDistinct(upstreamModelPricingWindows.upstreamModelId),
      })
      .from(pricingWindows)
      .leftJoin(
        upstreamModelPricingWindows,
        eq(upstreamModelPricingWindows.pricingWindowId, pricingWindows.id),
      )
      .groupBy(pricingWindows.id)
      .orderBy(asc(pricingWindows.name));
    const now = new Date();
    return rows.map((row) => ({ ...row, isActiveNow: isPricingWindowActiveAt(row, now) }));
  }
}
