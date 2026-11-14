import type { ClientProtocol, GatewayErrorCode } from "@/db/schemas/index.js";

/** A Usage Log as the Usage page lists it. Names are null once the Model or API Key is deleted. */
export interface UsageLogSummary {
  id: string;
  createdAt: Date;
  modelId: string | null;
  modelName: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  clientProtocol: ClientProtocol;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
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

export interface UsageLogPage {
  items: UsageLogSummary[];
  /** How many Usage Logs match the filters, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The requests, tokens and Cost of one Model or API Key. `id` and `name` are
 * null for logs whose Model or API Key is gone, or never existed (a request
 * refused before either was known). Unreported tokens and unknown Costs count as 0.
 */
export interface UsageTotal {
  id: string | null;
  name: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface UsageTotals {
  byModel: UsageTotal[];
  byApiKey: UsageTotal[];
}
