import { percent } from "./chart";
import type { ErrorOrigin } from "./errorOrigins";
import type { TimeRange } from "./usage";

export const OVERVIEW_RANGES = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const satisfies Partial<Record<TimeRange, string>>;
export type OverviewRange = keyof typeof OVERVIEW_RANGES;

export function isOverviewRange(value: string): value is OverviewRange {
  return Object.hasOwn(OVERVIEW_RANGES, value);
}

export interface OriginErrors {
  count: number;
  rate: number | null;
}

export interface OverviewStats {
  requestCount: number;
  cost: number;
  cacheHitRate: number | null;
  errorRate: number | null;
  failedCount: number;
  errorsByOrigin: Record<ErrorOrigin, OriginErrors>;
}

export interface OverviewBucket extends OverviewStats {
  start: string;
}

export interface Overview {
  range: OverviewRange;
  bucketSeconds: number;
  buckets: OverviewBucket[];
  totals: OverviewStats;
  hasUsageLogs: boolean;
}

const tickCostFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 2,
});

export function formatCostTick(cost: number): string {
  return tickCostFormat.format(cost);
}

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

const hourTick = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekdayHourTick = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit" });
const timeTitle = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const utcDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const utcDayTitle = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

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

const NO_DATA = "—";

export function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : percent(rate);
}
