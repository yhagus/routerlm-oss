import type { ErrorOrigin } from "~/lib/errorOrigins";
import type { RecordedIntegration } from "~/lib/integrations";
import type { ServiceTier } from "~/lib/parameterPolicy";

/** A Usage Log as `GET /api/usage` lists it. Names are null once the Model or API Key is deleted. */
export interface UsageLogSummary extends RecordedIntegration {
  id: string;
  createdAt: string;
  modelId: string | null;
  modelName: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  clientProtocol: string;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: string | null;
  /** Who caused the failure; null for a successful or cancelled request, and on older rows. */
  errorOrigin: ErrorOrigin | null;
  /** Who sent the request and from where; null on rows recorded before they were. */
  userAgent: string | null;
  clientIp: string | null;
  /** The Service Tier that served the request; null for the Provider's default. */
  serviceTier: ServiceTier | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  requestBytes: number;
  responseBytes: number;
  cost: number | null;
  timeToFirstTokenMs: number | null;
  durationMs: number;
  attemptCount: number;
  isCancelled: boolean;
  isIncomplete: boolean;
}

/** One try of a request against one Provider Account. Names are null when there was none. */
export interface UsageLogAttempt {
  id: string;
  startedAt: string;
  routeId: string | null;
  upstreamModelId: string | null;
  upstreamModelName: string | null;
  providerSlug: string | null;
  providerName: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  /** Null when no response arrived (timeout or connection error). */
  upstreamStatus: number | null;
  /** Null for the Attempt that succeeded. */
  failureReason: string | null;
  /** The request id the Provider returned, for its support; null when it returned none. */
  upstreamRequestId: string | null;
  durationMs: number;
}

/** One Usage Log from `GET /api/usage/:id`: the list item plus its Attempts, first first. */
export interface UsageLogDetail extends UsageLogSummary {
  attempts: UsageLogAttempt[];
}

export interface UsageLogPage {
  items: UsageLogSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * `GET /api/usage/totals` over the filtered requests. Unreported tokens count as zero; the
 * percentiles are null when no request in the range reported that timing.
 */
export interface UsageSummary {
  requestCount: number;
  succeededCount: number;
  failedCount: number;
  /** The failed count per Error Origin; failed requests with no origin count in none. */
  failedByOrigin: Record<ErrorOrigin, number>;
  cancelledCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  durationMsP50: number | null;
  durationMsP95: number | null;
  timeToFirstTokenMsP50: number | null;
  timeToFirstTokenMsP95: number | null;
}

export const USAGE_STATUSES = ["succeeded", "failed", "cancelled"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const USAGE_STATUS_LABELS = {
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const satisfies Record<UsageStatus, string>;

/** The `.status-badge` modifier for each status. */
export const USAGE_STATUS_BADGES = {
  succeeded: "status-badge--good",
  failed: "status-badge--bad",
  cancelled: "status-badge--warn",
} as const satisfies Record<UsageStatus, string>;

/** How a request ended, as the Usage page filters and labels it. */
export function usageStatusOf(log: UsageLogSummary): UsageStatus {
  if (log.isCancelled) return "cancelled";
  if (log.errorCode !== null || log.httpStatus >= 400) return "failed";
  return "succeeded";
}

const HOUR_MS = 60 * 60 * 1000;

/** The time ranges the Usage page offers, as how far back they reach. Null reaches back forever. */
export const TIME_RANGES = {
  "1h": { label: "Last hour", lookbackMs: HOUR_MS },
  "24h": { label: "Last 24 hours", lookbackMs: 24 * HOUR_MS },
  "7d": { label: "Last 7 days", lookbackMs: 7 * 24 * HOUR_MS },
  "30d": { label: "Last 30 days", lookbackMs: 30 * 24 * HOUR_MS },
  all: { label: "All time", lookbackMs: null },
} as const satisfies Record<string, { label: string; lookbackMs: number | null }>;
export type TimeRange = keyof typeof TIME_RANGES;

export function isTimeRange(value: string): value is TimeRange {
  return Object.hasOwn(TIME_RANGES, value);
}

/** The ISO start of `range` counted back from `now`; undefined for all time. */
export function timeRangeStart(range: TimeRange, now: number): string | undefined {
  const { lookbackMs } = TIME_RANGES[range];
  return lookbackMs === null ? undefined : new Date(now - lookbackMs).toISOString();
}

const costFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const countFormat = new Intl.NumberFormat();

export function formatCost(cost: number | null): string {
  return cost === null ? "—" : costFormat.format(cost);
}

/** A token count; "—" when the upstream didn't report it. */
export function formatCount(count: number | null): string {
  return count === null ? "—" : countFormat.format(count);
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}
