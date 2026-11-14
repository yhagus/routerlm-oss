import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, desc, eq, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../../../db/schemas/relations.js";
import { apiKeys, models, usageLogs } from "../../../db/schemas/index.js";
import type { UsageTotals } from "../../models/usage.js";
import { whereFilter } from "../../models/usage-filters.js";
import { TotalUsageQuery } from "../impl/total-usage.query.js";

/** Each sorted by Cost, then by request count, highest first. Totals run in SQL. */
@QueryHandler(TotalUsageQuery)
export class TotalUsageHandler implements IQueryHandler<TotalUsageQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ filter }: TotalUsageQuery): Promise<UsageTotals> {
    const where = whereFilter(filter);
    const modelTotals = totalColumns(usageLogs.modelId, models.name);
    const apiKeyTotals = totalColumns(usageLogs.apiKeyId, apiKeys.name);
    const [byModel, byApiKey] = await Promise.all([
      this.db
        .select(modelTotals)
        .from(usageLogs)
        .leftJoin(models, eq(models.id, usageLogs.modelId))
        .where(where)
        .groupBy(usageLogs.modelId, models.name)
        .orderBy(desc(modelTotals.cost), desc(modelTotals.requestCount)),
      this.db
        .select(apiKeyTotals)
        .from(usageLogs)
        .leftJoin(apiKeys, eq(apiKeys.id, usageLogs.apiKeyId))
        .where(where)
        .groupBy(usageLogs.apiKeyId, apiKeys.name)
        .orderBy(desc(apiKeyTotals.cost), desc(apiKeyTotals.requestCount)),
    ]);
    return { byModel, byApiKey };
  }
}

/** What a UsageTotal adds up, for the logs grouped by `id` (named by `name`). */
function totalColumns<Id extends AnyPgColumn, Name extends AnyPgColumn>(id: Id, name: Name) {
  return {
    id,
    name,
    requestCount: count(),
    inputTokens: summed(usageLogs.inputTokens),
    outputTokens: summed(usageLogs.outputTokens),
    cacheReadTokens: summed(usageLogs.cacheReadTokens),
    cacheWriteTokens: summed(usageLogs.cacheWriteTokens),
    cost: summed(usageLogs.cost),
  };
}

/** The sum of a nullable column over a group; nulls (unreported, unknown) count as 0. */
function summed(column: AnyPgColumn): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
}
