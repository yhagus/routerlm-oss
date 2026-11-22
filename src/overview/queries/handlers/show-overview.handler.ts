import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, count, gte, lt, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type ErrorOrigin, usageLogs } from "@/db/schemas/index.js";
import { byErrorOrigin } from "@/usage/models/by-error-origin.js";
import { failedWithOriginCondition, statusCondition } from "@/usage/models/usage-filters.js";
import {
  OVERVIEW_BUCKETS,
  type Overview,
  type OverviewBucket,
  type OriginErrors,
  type OverviewStats,
} from "@/overview/models/overview.js";
import { ShowOverviewQuery } from "@/overview/queries/impl/show-overview.query.js";

const MS_PER_SECOND = 1000;

const EMPTY_STATS: OverviewStats = {
  requestCount: 0,
  cost: 0,
  cacheHitRate: null,
  errorRate: null,
  failedCount: 0,
  errorsByOrigin: byErrorOrigin(() => ({ count: 0, rate: null })),
};

/**
 * Aggregates Usage Logs over time for the Overview. Bucketing and every sum
 * and rate run in SQL; only the empty buckets are filled in here.
 */
@QueryHandler(ShowOverviewQuery)
export class ShowOverviewHandler implements IQueryHandler<ShowOverviewQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ range }: ShowOverviewQuery): Promise<Overview> {
    const { bucketSeconds, bucketCount } = OVERVIEW_BUCKETS[range];
    const bucketMs = bucketSeconds * MS_PER_SECOND;
    const endMs = Math.floor(Date.now() / bucketMs) * bucketMs + bucketMs;
    const startMs = endMs - bucketCount * bucketMs;
    const inRange = and(
      gte(usageLogs.createdAt, new Date(startMs)),
      lt(usageLogs.createdAt, new Date(endMs)),
    );
    // A literal rather than a parameter, so the SELECT and GROUP BY render the
    // same expression; bucketSeconds comes from OVERVIEW_BUCKETS, never from input.
    const bucketStartSeconds = sql<number>`extract(epoch from date_bin(${sql.raw(
      `interval '${bucketSeconds} seconds'`,
    )}, ${usageLogs.createdAt}, timestamptz 'epoch'))`.mapWith(Number);

    const [bucketRows, [totals], anyUsageLog] = await Promise.all([
      this.db
        .select({ startSeconds: bucketStartSeconds, ...statsColumns() })
        .from(usageLogs)
        .where(inRange)
        .groupBy(bucketStartSeconds),
      this.db.select(statsColumns()).from(usageLogs).where(inRange),
      this.db.select({ id: usageLogs.id }).from(usageLogs).limit(1),
    ]);

    const statsByStartMs = new Map<number, OverviewStats>(
      bucketRows.map(({ startSeconds, ...stats }) => [startSeconds * MS_PER_SECOND, stats]),
    );
    const buckets = Array.from({ length: bucketCount }, (_, index): OverviewBucket => {
      const bucketStartMs = startMs + index * bucketMs;
      const stats = statsByStartMs.get(bucketStartMs) ?? EMPTY_STATS;
      return { start: new Date(bucketStartMs), ...stats };
    });
    return { range, bucketSeconds, buckets, totals, hasUsageLogs: anyUsageLog.length > 0 };
  }
}

/** What OverviewStats aggregates over a group of Usage Logs. */
function statsColumns() {
  const totalInputTokens = sql`coalesce(${usageLogs.inputTokens}, 0)
    + coalesce(${usageLogs.cacheReadTokens}, 0)
    + coalesce(${usageLogs.cacheWriteTokens}, 0)`;
  const failedCount = sql<number>`count(*) filter (where ${statusCondition("failed")})`.mapWith(
    Number,
  );
  return {
    requestCount: count(),
    cost: sql<number>`coalesce(sum(${usageLogs.cost}), 0)`.mapWith(Number),
    cacheHitRate: ratio(
      sql`sum(coalesce(${usageLogs.cacheReadTokens}, 0))`,
      sql`sum(${totalInputTokens})`,
    ),
    errorRate: ratio(failedCount, sql`count(*)`),
    failedCount,
    errorsByOrigin: byErrorOrigin(originErrorsColumn),
  };
}

/**
 * What OriginErrors aggregates over a group of Usage Logs, as one JSON object:
 * a Drizzle selection nests only one level deep.
 */
function originErrorsColumn(origin: ErrorOrigin): SQL<OriginErrors> {
  const failedWithOrigin = sql`count(*) filter (where ${failedWithOriginCondition(origin)})`;
  return sql<OriginErrors>`json_build_object(
    'count', ${failedWithOrigin},
    'rate', ${ratio(failedWithOrigin, sql`count(*)`)}
  )`;
}

/** `part / whole` as a float, or null when `whole` is 0 or null. */
function ratio(part: SQL, whole: SQL): SQL<number | null> {
  return sql<number | null>`(${part})::float8 / nullif(${whole}, 0)`.mapWith(Number);
}
