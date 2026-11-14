import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, count, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../db/relations.js";
import { apiKeys, models, usageLogs } from "../db/schema.js";
import type { UsageLogPage, UsageTotals } from "./usage.js";
import type { UsageFilter, UsagePageQuery, UsageStatus } from "./usage.schemas.js";

const FIRST_ERROR_STATUS = 400;

/**
 * Reads Usage Logs for the dashboard. Filtering, paging and totals all run
 * in SQL, so a large table is never loaded whole.
 */
@Injectable()
export class UsageService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Newest first. */
  async listUsageLogs(query: UsagePageQuery): Promise<UsageLogPage> {
    const where = whereFilter(query);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: usageLogs.id,
          createdAt: usageLogs.createdAt,
          modelId: usageLogs.modelId,
          modelName: models.name,
          apiKeyId: usageLogs.apiKeyId,
          apiKeyName: apiKeys.name,
          isPlayground: usageLogs.isPlayground,
          clientProtocol: usageLogs.clientProtocol,
          isStreamed: usageLogs.isStreamed,
          httpStatus: usageLogs.httpStatus,
          errorCode: usageLogs.errorCode,
          inputTokens: usageLogs.inputTokens,
          outputTokens: usageLogs.outputTokens,
          cacheReadTokens: usageLogs.cacheReadTokens,
          cacheWriteTokens: usageLogs.cacheWriteTokens,
          reasoningTokens: usageLogs.reasoningTokens,
          requestBytes: usageLogs.requestBytes,
          responseBytes: usageLogs.responseBytes,
          cost: usageLogs.cost,
          timeToFirstTokenMs: usageLogs.timeToFirstTokenMs,
          durationMs: usageLogs.durationMs,
          attemptCount: usageLogs.attemptCount,
          isCancelled: usageLogs.isCancelled,
          isIncomplete: usageLogs.isIncomplete,
        })
        .from(usageLogs)
        .leftJoin(models, eq(models.id, usageLogs.modelId))
        .leftJoin(apiKeys, eq(apiKeys.id, usageLogs.apiKeyId))
        .where(where)
        .orderBy(desc(usageLogs.createdAt), desc(usageLogs.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(usageLogs).where(where),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Each sorted by Cost, then by request count, highest first. */
  async totalUsage(filter: UsageFilter): Promise<UsageTotals> {
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

function whereFilter(filter: UsageFilter): SQL | undefined {
  return and(
    filter.from === undefined ? undefined : gte(usageLogs.createdAt, filter.from),
    filter.to === undefined ? undefined : lt(usageLogs.createdAt, filter.to),
    filter.modelId === undefined ? undefined : eq(usageLogs.modelId, filter.modelId),
    filter.apiKeyId === undefined ? undefined : eq(usageLogs.apiKeyId, filter.apiKeyId),
    filter.status === undefined ? undefined : statusCondition(filter.status),
  );
}

export function statusCondition(status: UsageStatus): SQL | undefined {
  switch (status) {
    case "cancelled":
      return eq(usageLogs.isCancelled, true);
    case "failed":
      return and(
        eq(usageLogs.isCancelled, false),
        or(isNotNull(usageLogs.errorCode), gte(usageLogs.httpStatus, FIRST_ERROR_STATUS)),
      );
    case "succeeded":
      return and(
        eq(usageLogs.isCancelled, false),
        isNull(usageLogs.errorCode),
        lt(usageLogs.httpStatus, FIRST_ERROR_STATUS),
      );
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
