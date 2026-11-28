import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '@/db/schemas/relations';
import { type ErrorOrigin, usageLogs } from '@/db/schemas';
import type { UpstreamOutputSpeed, UsageSummary } from '@/usage/models/usage';
import { hasOutputSpeed, outputSpeed } from '@/usage/models/output-speed';
import { byErrorOrigin } from '@/usage/models/by-error-origin';
import {
  failedWithOriginCondition,
  statusCondition,
  whereFilter,
} from '@/usage/models/usage-filters';
import type { UsageFilter, UsageStatus } from '@/usage/schemas/usage.schema';
import { SummarizeUsageQuery } from '@/usage/queries/impl/summarize-usage.query';

const MEDIAN = 0.5;
const P95 = 0.95;
const P5 = 0.05;

@QueryHandler(SummarizeUsageQuery)
export class SummarizeUsageHandler implements IQueryHandler<SummarizeUsageQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ filter }: SummarizeUsageQuery): Promise<UsageSummary> {
    const [[summary], outputSpeedByUpstream] = await Promise.all([
      this.summarize(filter),
      this.outputSpeedByUpstream(filter),
    ]);
    return { ...summary, outputSpeedByUpstream };
  }

  private summarize(filter: UsageFilter) {
    return this.db
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
        outputSpeedP50: outputSpeedPercentile(MEDIAN),
        outputSpeedP5: outputSpeedPercentile(P5),
      })
      .from(usageLogs)
      .where(whereFilter(filter));
  }

  private async outputSpeedByUpstream(filter: UsageFilter): Promise<UpstreamOutputSpeed[]> {
    const rows = await this.db
      .select({
        upstreamModelId: usageLogs.upstreamModelId,
        upstreamModelName: latest(usageLogs.upstreamModelName),
        providerAccountId: usageLogs.providerAccountId,
        providerAccountName: latest(usageLogs.providerAccountName),
        outputSpeedP50: outputSpeedPercentile(MEDIAN),
        outputSpeedP5: outputSpeedPercentile(P5),
      })
      .from(usageLogs)
      .where(
        and(
          whereFilter(filter),
          hasOutputSpeed,
          isNotNull(usageLogs.upstreamModelId),
          isNotNull(usageLogs.providerAccountId),
        ),
      )
      .groupBy(usageLogs.upstreamModelId, usageLogs.providerAccountId)
      .orderBy(usageLogs.upstreamModelId, usageLogs.providerAccountId);
    return rows.flatMap((row) => {
      const { upstreamModelId, providerAccountId, outputSpeedP50, outputSpeedP5 } = row;
      if (
        !upstreamModelId ||
        !providerAccountId ||
        outputSpeedP50 === null ||
        outputSpeedP5 === null
      ) {
        return [];
      }
      return [{ ...row, upstreamModelId, providerAccountId, outputSpeedP50, outputSpeedP5 }];
    });
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

function outputSpeedPercentile(fraction: number): SQL<number | null> {
  return sql<
    number | null
  >`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${outputSpeed}) filter (where ${hasOutputSpeed})`.mapWith(
    Number,
  );
}

function latest(column: AnyPgColumn): SQL<string | null> {
  return sql<string | null>`(array_agg(${column} order by ${usageLogs.createdAt} desc))[1]`;
}

function percentile(fraction: number, column: AnyPgColumn): SQL<number | null> {
  return sql<
    number | null
  >`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${column})`.mapWith(
    Number,
  );
}
