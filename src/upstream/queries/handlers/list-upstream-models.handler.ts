import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { upstreamModels } from "@/db/schemas";
import { ListAttachedPricingWindowsQuery } from "@/pricing-windows/queries/impl/list-attached-pricing-windows.query";
import type { ListedUpstreamModel } from "@/upstream/models/upstream-model";
import { ListUpstreamModelsQuery } from "@/upstream/queries/impl/list-upstream-models.query";

@QueryHandler(ListUpstreamModelsQuery)
export class ListUpstreamModelsHandler implements IQueryHandler<ListUpstreamModelsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(): Promise<ListedUpstreamModel[]> {
    const [rows, pricingWindowsByUpstreamModelId] = await Promise.all([
      this.db
        .select()
        .from(upstreamModels)
        .orderBy(asc(upstreamModels.providerId), asc(upstreamModels.upstreamModelId)),
      this.queryBus.execute(new ListAttachedPricingWindowsQuery()),
    ]);
    return rows.map((row) => ({
      ...row,
      pricingWindows: pricingWindowsByUpstreamModelId.get(row.id) ?? [],
    }));
  }
}
