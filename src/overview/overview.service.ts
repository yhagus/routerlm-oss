import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, count, gte, lt, type SQL, sql } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { usageLogs } from "../db/schema.js";
import { statusCondition } from "../usage/usage.service.js";
import {
  OVERVIEW_BUCKETS,
  type Overview,
  type OverviewBucket,
  type OverviewRange,
  type OverviewStats,
} from "./overview.js";

const MS_PER_SECOND = 1000;

const EMPTY_STATS: OverviewStats = {
  requestCount: 0,
  cost: 0,
  cacheHitRate: null,
  errorRate: null,
};

/**
 * Aggregates Usage Logs over time for the Overview. Bucketing and every sum
 * and rate run in SQL; only the empty buckets are filled in here.
 */
@Injectable()
export class OverviewService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async overviewOf(range: OverviewRange): Promise<Overview> {
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
  return {
    requestCount: count(),
    cost: sql<number>`coalesce(sum(${usageLogs.cost}), 0)`.mapWith(Number),
    cacheHitRate: ratio(
      sql`sum(coalesce(${usageLogs.cacheReadTokens}, 0))`,
      sql`sum(${totalInputTokens})`,
    ),
    errorRate: ratio(sql`count(*) filter (where ${statusCondition("failed")})`, sql`count(*)`),
  };
}

/** `part / whole` as a float, or null when `whole` is 0 or null. */
function ratio(part: SQL, whole: SQL): SQL<number | null> {
  return sql<number | null>`(${part})::float8 / nullif(${whole}, 0)`.mapWith(Number);
}
