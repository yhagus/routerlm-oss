import type {
  ClientProtocol,
  ErrorOrigin,
  FinishReason,
  GatewayErrorCode,
  RecordedAttemptFailure,
  UpstreamProtocol,
} from '@/db/schemas';
import type { ReasoningEffort, ServiceTier } from '@/inference/models/internal-format';

export interface UsageLogSummary {
  id: string;
  createdAt: Date;
  modelId: string | null;
  modelName: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
  isPlayground: boolean;
  userId: string | null;
  userEmail: string | null;
  upstreamModelName: string | null;
  providerSlug: string | null;
  providerName: string | null;
  providerAccountName: string | null;
  clientProtocol: ClientProtocol;
  upstreamProtocol: UpstreamProtocol | null;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  errorOrigin: ErrorOrigin | null;
  userAgent: string | null;
  clientIp: string | null;
  serviceTier: ServiceTier | null;
  pricingWindowName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  requestBytes: number;
  responseBytes: number;
  cost: number | null;
  timeToFirstTokenMs: number | null;
  isReasoningStreamed: boolean;
  finishReason: FinishReason | null;
  maxOutputTokens: number | null;
  reasoningEffort: ReasoningEffort | null;
  thinkingBudgetTokens: number | null;
  toolCount: number;
  toolCallCount: number;
  imageCount: number | null;
  durationMs: number;
  attemptCount: number;
  isCancelled: boolean;
  isIncomplete: boolean;
}

export interface UsageLogAttempt {
  id: string;
  startedAt: Date;
  routeId: string | null;
  upstreamModelId: string | null;
  upstreamModelName: string | null;
  providerSlug: string | null;
  providerName: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
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
