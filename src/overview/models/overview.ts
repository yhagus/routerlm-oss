import type { ErrorOrigin } from "@/db/schemas/index.js";

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/** The time ranges the Overview offers, ending now. */
export const OVERVIEW_RANGES = ["24h", "7d", "30d"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/**
 * How each range is cut into buckets aligned to UTC: 24 hourly, 28 six-hour
 * or 30 daily buckets, the last one holding now.
 */
export const OVERVIEW_BUCKETS = {
  "24h": { bucketSeconds: HOUR_SECONDS, bucketCount: 24 },
  "7d": { bucketSeconds: 6 * HOUR_SECONDS, bucketCount: 28 },
  "30d": { bucketSeconds: DAY_SECONDS, bucketCount: 30 },
} as const satisfies Record<OverviewRange, { bucketSeconds: number; bucketCount: number }>;

/**
 * Requests, Cost, cache hit rate and error rate of the Usage Logs in one
 * bucket or a whole range.
 *
 * - `cost` counts unknown Costs as 0.
 * - `cacheHitRate` is cache-read tokens / total input tokens, where total
 *   input tokens = input + cache-read + cache-write tokens: a Usage Log's
 *   `inputTokens` never includes cached input, whatever the upstream
 *   Protocol. Null when no input tokens were reported.
 * - `errorRate` is failed requests / all requests, "failed" as the Usage
 *   page filters it (a cancelled request is not an error). Null without requests.
 * - `errorsByOrigin` splits the failed requests by Error Origin, with all
 *   three origins always present. Failures recorded without an origin count
 *   in `errorRate` only, so the origin counts can add up to less.
 */
export interface OverviewStats {
  requestCount: number;
  cost: number;
  cacheHitRate: number | null;
  errorRate: number | null;
  errorsByOrigin: ErrorsByOrigin;
}

/**
 * The failed requests of one Error Origin. `rate` is over all requests, not
 * just the failed ones, so the three rates add up to at most `errorRate`.
 * Null without requests.
 */
export interface OriginErrors {
  count: number;
  rate: number | null;
}

export type ErrorsByOrigin = Record<ErrorOrigin, OriginErrors>;

export interface OverviewBucket extends OverviewStats {
  /** Inclusive; the bucket ends `bucketSeconds` later. */
  start: Date;
}

export interface Overview {
  range: OverviewRange;
  bucketSeconds: number;
  /** Oldest first, one per bucket, empty ones included. */
  buckets: OverviewBucket[];
  totals: OverviewStats;
  /** False until the gateway has recorded any request, in any range. */
  hasUsageLogs: boolean;
}
