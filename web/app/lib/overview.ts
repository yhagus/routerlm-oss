/** The time ranges the Overview offers, ending now. */
export const OVERVIEW_RANGES = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const;
export type OverviewRange = keyof typeof OVERVIEW_RANGES;

export function isOverviewRange(value: string): value is OverviewRange {
  return Object.hasOwn(OVERVIEW_RANGES, value);
}

/**
 * Requests, Cost, cache hit rate and error rate over a bucket or the whole
 * range, as `GET /api/overview` returns them. Rates are fractions (0–1), null
 * when there was nothing to divide by.
 */
export interface OverviewStats {
  requestCount: number;
  cost: number;
  cacheHitRate: number | null;
  errorRate: number | null;
}

export interface OverviewBucket extends OverviewStats {
  /** ISO start of the bucket. */
  start: string;
}

export interface Overview {
  range: OverviewRange;
  bucketSeconds: number;
  /** Oldest first, empty buckets included; the last holds now. */
  buckets: OverviewBucket[];
  totals: OverviewStats;
  /** False until the gateway has recorded any request. */
  hasUsageLogs: boolean;
}

const tickCostFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 2,
});

/** A Cost short enough for an axis tick. */
export function formatCostTick(cost: number): string {
  return tickCostFormat.format(cost);
}

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

const hourTick = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekdayHourTick = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit" });
const timeTitle = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
// Daily buckets are UTC days (the backend aligns every bucket to UTC), so they
// are labelled in UTC; a local date would name the wrong day west or east of it.
const utcDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const utcDayTitle = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

/** The axis label and the tooltip title of a bucket `bucketSeconds` wide starting at `start`. */
export function bucketLabels(
  start: string,
  bucketSeconds: number,
): { tick: string; title: string } {
  const startDate = new Date(start);
  if (bucketSeconds >= DAY_SECONDS) {
    return { tick: utcDay.format(startDate), title: `${utcDayTitle.format(startDate)} (UTC)` };
  }
  const end = new Date(startDate.getTime() + bucketSeconds * 1000);
  const tickFormat = bucketSeconds > HOUR_SECONDS ? weekdayHourTick : hourTick;
  return {
    tick: tickFormat.format(startDate),
    title: `${timeTitle.format(startDate)} – ${hourTick.format(end)}`,
  };
}
