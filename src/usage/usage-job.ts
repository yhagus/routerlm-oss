import type { ClientProtocol, GatewayErrorCode, RecordedAttemptFailure } from "../db/schema.js";
import type { TokenUsage } from "../inference/internal-format.js";

/** The job that turns one inference request into its Usage Log and Attempts. */
export const RECORD_USAGE_JOB = "record";

/**
 * Who made the request. "unidentified" is a request refused before its API
 * Key was known (a bad key, or a body that could not be read).
 */
export type UsageCaller =
  | { kind: "api-key"; apiKeyId: string }
  | { kind: "playground"; userId: string }
  | { kind: "unidentified" };

/** An Upstream Model's prices when the request was made, in USD per million tokens. */
export interface UpstreamModelPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

/** The Route and Provider Account whose Attempt answered the request. */
export interface ServedBy {
  routeId: string;
  providerAccountId: string;
  prices: UpstreamModelPrices;
}

/** One upstream call. Times are ISO strings: job data travels as JSON. */
export interface AttemptRecord {
  startedAt: string;
  routeId: string;
  providerAccountId: string;
  /** Null when no response arrived. */
  upstreamStatus: number | null;
  /** Null for the Attempt that answered and finished normally. */
  failureReason: RecordedAttemptFailure | null;
  durationMs: number;
}

/**
 * Measurements of one inference request, enqueued by the backend and written
 * by the worker. Never holds prompt or response content (ADR 0004).
 */
export interface UsageJob {
  /** Chosen by the backend, so a retried job never writes the Usage Log twice. */
  usageLogId: string;
  /** When the gateway received the request. */
  receivedAt: string;
  caller: UsageCaller;
  /** Null when the request failed before its Model was resolved. */
  modelId: string | null;
  clientProtocol: ClientProtocol;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  /** Null when no Attempt answered. */
  servedBy: ServedBy | null;
  /** The upstream's last usage report; null when it sent none. */
  usage: TokenUsage | null;
  requestBytes: number;
  responseBytes: number;
  /** Streams only: until the first event arrived from the upstream. */
  timeToFirstTokenMs: number | null;
  durationMs: number;
  isCancelled: boolean;
  /** In the order they were made. */
  attempts: AttemptRecord[];
}
