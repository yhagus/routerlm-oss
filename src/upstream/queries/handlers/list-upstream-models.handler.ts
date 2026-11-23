import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { readAttachedPricingWindows } from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import type { ListedUpstreamModel } from "@/upstream/models/upstream-model.js";
import { ListUpstreamModelsQuery } from "@/upstream/queries/impl/list-upstream-models.query.js";

@QueryHandler(ListUpstreamModelsQuery)
export class ListUpstreamModelsHandler implements IQueryHandler<ListUpstreamModelsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute(): Promise<ListedUpstreamModel[]> {
    const [rows, pricingWindowsByUpstreamModelId] = await Promise.all([
      this.db
        .select()
        .from(upstreamModels)
        .orderBy(asc(upstreamModels.providerId), asc(upstreamModels.upstreamModelId)),
      readAttachedPricingWindows(this.db),
    ]);
    return rows.map((row) => ({
      ...row,
      pricingWindows: pricingWindowsByUpstreamModelId.get(row.id) ?? [],
    }));
  }
}
