import type { ErrorOrigin } from '~/lib/errorOrigins';
import type { RecordedIntegration } from '~/lib/integrations';
import type { ReasoningEffort, ServiceTier } from '~/lib/parameterPolicy';

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other';

export const FINISH_REASON_LABELS = {
  stop: 'Finished',
  length: 'Hit the output limit',
  tool_calls: 'Called a tool',
  content_filter: 'Filtered by the Provider',
  other: 'Other',
} as const satisfies Record<FinishReason, string>;

export const OUTPUT_SPEED_HINT =
  'Output tokens per second while a streamed response is being generated, after its Time to First Token. Reasoning tokens count only when they were streamed; hidden reasoning happens before the first output and is left out. Only successful, complete, uncancelled streamed requests with enough output to measure have one.';

export interface UsageLogSummary extends RecordedIntegration {
  id: string;
  createdAt: string;
  modelId: string | null;
  modelName: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  userId: string | null;
  userEmail: string | null;
  upstreamModelName: string | null;
  providerSlug: string | null;
  providerName: string | null;
  providerAccountName: string | null;
  clientProtocol: string;
  upstreamProtocol: string | null;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: string | null;
  errorOrigin: ErrorOrigin | null;
  userAgent: string | null;
  clientIp: string | null;
  serviceTier: ServiceTier | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  requestBytes: number;
  responseBytes: number;
  cost: number | null;
  pricingWindowName: string | null;
  timeToFirstTokenMs: number | null;
  durationMs: number;
  slotWaitMs: number;
  attemptCount: number;
  isCancelled: boolean;
  isIncomplete: boolean;
  isReasoningStreamed: boolean;
  finishReason: FinishReason | null;
  maxOutputTokens: number | null;
  reasoningEffort: ReasoningEffort | null;
  thinkingBudgetTokens: number | null;
  toolCount: number;
  toolCallCount: number;
  imageCount: number | null;
}

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
  upstreamStatus: number | null;
  failureReason: string | null;
  upstreamRequestId: string | null;
  durationMs: number;
}

export interface UsageLogDetail extends UsageLogSummary {
  attempts: UsageLogAttempt[];
}

export interface UsageLogPage {
  items: UsageLogSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UsageSummary {
  requestCount: number;
  succeededCount: number;
  failedCount: number;
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
  outputSpeedP50: number | null;
  outputSpeedP5: number | null;
  outputSpeedByUpstream: UpstreamOutputSpeed[];
}

export interface UpstreamOutputSpeed {
  upstreamModelId: string;
  upstreamModelName: string | null;
  providerAccountId: string;
  providerAccountName: string | null;
  outputSpeedP50: number;
  outputSpeedP5: number;
}

export const USAGE_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const USAGE_STATUS_LABELS = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const satisfies Record<UsageStatus, string>;

export const USAGE_STATUS_BADGES = {
  succeeded: 'status-badge--good',
  failed: 'status-badge--bad',
  cancelled: 'status-badge--warn',
} as const satisfies Record<UsageStatus, string>;

export function usageStatusOf(log: UsageLogSummary): UsageStatus {
  if (log.isCancelled) return 'cancelled';
  if (log.errorCode !== null || log.httpStatus >= 400) return 'failed';
  return 'succeeded';
}

export function hasErrorCaptures(log: UsageLogSummary): boolean {
  return usageStatusOf(log) === 'failed' && (log.apiKeyId !== null || log.isPlayground);
}

const HOUR_MS = 60 * 60 * 1000;

export const TIME_RANGES = {
  '1h': { label: 'Last hour', lookbackMs: HOUR_MS },
  '24h': { label: 'Last 24 hours', lookbackMs: 24 * HOUR_MS },
  '7d': { label: 'Last 7 days', lookbackMs: 7 * 24 * HOUR_MS },
  '30d': { label: 'Last 30 days', lookbackMs: 30 * 24 * HOUR_MS },
  all: { label: 'All time', lookbackMs: null },
} as const satisfies Record<string, { label: string; lookbackMs: number | null }>;
export type TimeRange = keyof typeof TIME_RANGES;

export function isTimeRange(value: string): value is TimeRange {
  return Object.hasOwn(TIME_RANGES, value);
}

export function timeRangeStart(range: TimeRange, now: number): string | undefined {
  const { lookbackMs } = TIME_RANGES[range];
  return lookbackMs === null ? undefined : new Date(now - lookbackMs).toISOString();
}

const costFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const countFormat = new Intl.NumberFormat();

export function formatCost(cost: number | null): string {
  return cost === null ? '—' : costFormat.format(cost);
}

export function formatCount(count: number | null): string {
  return count === null ? '—' : countFormat.format(count);
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const SLOW_OUTPUT_SPEED = 10;

export function formatOutputSpeed(tokensPerSecond: number | null): string {
  if (tokensPerSecond === null) return '—';
  const digits = tokensPerSecond < SLOW_OUTPUT_SPEED ? 1 : 0;
  return `${tokensPerSecond.toFixed(digits)} tok/s`;
}

export function playgroundUserLabel(log: UsageLogSummary): string {
  return log.userEmail ?? 'deleted user';
}
