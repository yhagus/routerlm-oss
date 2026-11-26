import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { count, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '@/db/schemas/relations';
import { type ErrorOrigin, usageLogs } from '@/db/schemas';
import type { UsageSummary } from '@/usage/models/usage';
import { byErrorOrigin } from '@/usage/models/by-error-origin';
import {
  failedWithOriginCondition,
  statusCondition,
  whereFilter,
} from '@/usage/models/usage-filters';
import type { UsageStatus } from '@/usage/schemas/usage.schema';
import { SummarizeUsageQuery } from '@/usage/queries/impl/summarize-usage.query';

const MEDIAN = 0.5;
const P95 = 0.95;

@QueryHandler(SummarizeUsageQuery)
export class SummarizeUsageHandler implements IQueryHandler<SummarizeUsageQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ filter }: SummarizeUsageQuery): Promise<UsageSummary> {
    const [summary] = await this.db
      .select({
        requestCount: count(),
        succeededCount: countWithStatus('succeeded'),
        failedCount: countWithStatus('failed'),
        failedByOrigin: byErrorOrigin(countFailedWithOrigin),
        cancelledCount: countWithStatus('cancelled'),
        inputTokens: summed(usageLogs.inputTokens),
        outputTokens: summed(usageLogs.outputTokens),
        cacheReadTokens: summed(usageLogs.cacheReadTokens),
        cacheWriteTokens: summed(usageLogs.cacheWriteTokens),
        cost: summed(usageLogs.cost),
        durationMsP50: percentile(MEDIAN, usageLogs.durationMs),
        durationMsP95: percentile(P95, usageLogs.durationMs),
        timeToFirstTokenMsP50: percentile(MEDIAN, usageLogs.timeToFirstTokenMs),
        timeToFirstTokenMsP95: percentile(P95, usageLogs.timeToFirstTokenMs),
      })
      .from(usageLogs)
      .where(whereFilter(filter));
    return summary;
  }
}

function countWithStatus(status: UsageStatus): SQL<number> {
  return countWhere(statusCondition(status));
}

function countFailedWithOrigin(origin: ErrorOrigin): SQL<number> {
  return countWhere(failedWithOriginCondition(origin));
}

function countWhere(condition: SQL | undefined): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

function summed(column: AnyPgColumn): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
}

function percentile(fraction: number, column: AnyPgColumn): SQL<number | null> {
  return sql<
    number | null
  >`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${column})`.mapWith(
    Number,
  );
}
