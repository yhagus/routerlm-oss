import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, count, eq, getColumns } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { pricingWindows, upstreamModelPricingWindows } from "@/db/schemas/index.js";
import type { PricingWindowSummary } from "@/pricing-windows/models/pricing-window.js";
import { isPricingWindowActiveAt } from "@/pricing-windows/models/pricing-window-activity.js";
import { ListPricingWindowsQuery } from "@/pricing-windows/queries/impl/list-pricing-windows.query.js";

@QueryHandler(ListPricingWindowsQuery)
export class ListPricingWindowsHandler implements IQueryHandler<ListPricingWindowsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute(): Promise<PricingWindowSummary[]> {
    const rows = await this.db
      .select({
        ...getColumns(pricingWindows),
        attachedUpstreamModelCount: count(upstreamModelPricingWindows.id),
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
