import type {
  ClientProtocol,
  ErrorOrigin,
  GatewayErrorCode,
  RecordedAttemptFailure,
} from "@/db/schemas/index.js";
import type { ServiceTier } from "@/inference/models/internal-format.js";

/**
 * A Usage Log as the Usage page lists it. Names are as they were at request
 * time, and stay after the Model or API Key is renamed or deleted (ADR 0024).
 * They are null when there was none, or for rows written before names were copied.
 */
export interface UsageLogSummary {
  id: string;
  createdAt: Date;
  modelId: string | null;
  modelName: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  /**
   * The Integration that issued the API Key and the Customer it names, as
   * copied at request time, so they outlive the Integration; null for a key no
   * Integration issued.
   */
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
  isPlayground: boolean;
  clientProtocol: ClientProtocol;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  /** Who caused the failure (ADR 0031); null for a successful or cancelled request. */
  errorOrigin: ErrorOrigin | null;
  /** Who sent the request and from where (ADR 0032); null on rows recorded before they were. */
  userAgent: string | null;
  clientIp: string | null;
  /** The Service Tier that served the request; null for the Provider's default. */
  serviceTier: ServiceTier | null;
  /** The Pricing Window that priced the request, as named then; null for none. */
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
  durationMs: number;
  attemptCount: number;
  isCancelled: boolean;
  isIncomplete: boolean;
}

/**
 * One try of a request against one Provider Account. Names are copied at request
 * time like the Usage Log's (ADR 0024).
 */
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
  /** Null when no response arrived (timeout or connection error). */
  upstreamStatus: number | null;
  /** Null for the Attempt that succeeded. */
  failureReason: RecordedAttemptFailure | null;
  /** The request id the Provider returned, for its support; null when it returned none. */
  upstreamRequestId: string | null;
  durationMs: number;
}

/** A Usage Log as its detail view shows it: the list item plus its Attempts, first first. */
export interface UsageLogDetail extends UsageLogSummary {
  attempts: UsageLogAttempt[];
}

export interface UsageLogPage {
  items: UsageLogSummary[];
  /** How many Usage Logs match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One summary of the Usage Logs matching the filters. The status counts follow
 * the status filter's definitions. Unreported tokens and unknown Costs count as 0.
 * A percentile is null when no matching log has that measurement.
 */
export interface UsageSummary {
  requestCount: number;
  succeededCount: number;
  failedCount: number;
  /** The failed count per Error Origin; failed logs with no origin count in none (ADR 0031). */
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
