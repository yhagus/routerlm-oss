import type {
  ClientProtocol,
  PricesByTier,
  GatewayErrorCode,
  RecordedAttemptFailure,
} from "@/db/schemas/index.js";
import type { ServiceTier, TokenUsage } from "@/inference/models/internal-format.js";

/**
 * The units a media Kind counts for one request, and the size or resolution
 * that priced them. A unit the Kind doesn't count is left out.
 */
export interface MediaUnits {
  imagesOut?: number;
  imagesIn?: number;
  outputSeconds?: number;
  audioSeconds?: number;
  characters?: number;
  /** Such as `2K` or `720P`. */
  tier?: string;
}

/** The job that turns one inference request into its Usage Log and Attempts. */
export const RECORD_USAGE_JOB = "record";

/**
 * Who made the request. "unidentified" is a request refused before its API
 * Key was known (a bad key, or a body that could not be read).
 */
export type UsageCaller =
  | {
      kind: "api-key";
      apiKeyId: string;
      /** Always set now; optional only for jobs queued before Usage Logs copied names (ADR 0024). */
      apiKeyName?: string;
    }
  | { kind: "playground"; userId: string }
  | { kind: "unidentified" };

/** An Upstream Model's prices when the request was made, in USD per million tokens. */
export interface UpstreamModelPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

/**
 * An Upstream Model's unit prices when the request was made, in USD per
 * unit; a media Kind's Cost comes from them. Each Kind adds the prices of the
 * units it counts.
 */
export interface UpstreamModelUnitPrices {
  pricePerImage: number | null;
  /** By size tier, such as `2K`; a tier listed here wins over `pricePerImage`. */
  pricePerImageBySize: PricesByTier | null;
  pricePerInputImage: number | null;
  /** USD per million characters of synthesized speech. */
  pricePerMillionCharacters: number | null;
  /** USD per second of transcribed audio. */
  pricePerAudioSecond: number | null;
}

/**
 * What an Attempt tried, and so what served a request: the ids and the names
 * its records copy at request time (ADR 0024).
 */
export interface ServingTarget {
  /** Null for a direct Upstream Model test, which goes through no Route. */
  routeId: string | null;
  /** The `upstream_models` row id. */
  upstreamModelId: string;
  /** The model name as the Provider spells it in requests. */
  upstreamModelName: string;
  providerSlug: string;
  /** The Provider's display name. */
  providerName: string;
  providerAccountId: string;
  providerAccountName: string;
}

/**
 * A ServingTarget as a job carries it. Jobs queued before Usage Logs copied
 * names (ADR 0024) lack all but the Route and Provider Account ids, and jobs
 * queued before Attempts copied the Provider's name lack `providerName`. The
 * writer turns what is missing into null in one place.
 */
export type QueuedServingTarget = Pick<ServingTarget, "routeId" | "providerAccountId"> &
  Partial<Omit<ServingTarget, "routeId" | "providerAccountId">>;

/** The request's names that every Attempt copies from its Usage Log (ADR 0024). */
export interface RequestNames {
  /** Null when the request failed before its Model was resolved. */
  modelName: string | null;
  /** Null unless the caller used an API Key. */
  apiKeyName: string | null;
}

/** The target whose Attempt answered the request. */
export interface ServedBy extends QueuedServingTarget {
  /** Every job has it here; only an Attempt in an old job may lack it. */
  upstreamModelId: string;
  /** Null when it was served at the Provider's default. Missing in jobs queued before tiers existed. */
  serviceTier?: ServiceTier | null;
  /** The Upstream Model's prices at the Service Tier that served it. */
  prices: UpstreamModelPrices;
  /** Missing in jobs queued before media Kinds were priced. */
  unitPrices?: UpstreamModelUnitPrices;
}

/** One upstream call. Times are ISO strings: job data travels as JSON. */
export interface AttemptRecord extends QueuedServingTarget {
  startedAt: string;
  /** Null when no response arrived. */
  upstreamStatus: number | null;
  /** Null for the Attempt that answered and finished normally. */
  failureReason: RecordedAttemptFailure | null;
  durationMs: number;
}

/** Headers and body as an Error Capture stores them: credentials redacted, body truncated. */
export interface CapturedMessage {
  headers: Record<string, string>;
  body: string;
}

/** One failed Attempt's part of an Error Capture. */
export interface FailedAttemptCapture {
  /** Its index in `UsageJob.attempts`. */
  attemptIndex: number;
  /** Null when no response arrived (a timeout, a dropped connection, a stream cut short). */
  upstreamResponse: CapturedMessage | null;
}

/**
 * The content of a failed request or failed Attempt, for its Error Captures:
 * the one place content is kept (ADR 0004, ADR 0006). The worker writes one
 * capture per failed Attempt or, when none failed, one for the client request
 * itself.
 */
export interface ErrorCaptureRecord {
  request: CapturedMessage;
  failedAttempts: FailedAttemptCapture[];
}

/**
 * Measurements of one inference request, enqueued by the backend and written
 * by the worker. Only `errorCapture` holds content, and only for a failed
 * request or failed Attempt of an authenticated caller (ADR 0004, ADR 0006).
 */
export interface UsageJob {
  /** Chosen by the backend, so a retried job never writes the Usage Log twice. */
  usageLogId: string;
  /** When the gateway received the request. */
  receivedAt: string;
  caller: UsageCaller;
  /** Null when the request failed before its Model was resolved. */
  modelId: string | null;
  /** As named then. Missing in jobs queued before Usage Logs copied names (ADR 0024). */
  modelName?: string | null;
  clientProtocol: ClientProtocol;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  /** Null when no Attempt answered. */
  servedBy: ServedBy | null;
  /** The upstream's last usage report; null when it sent none. */
  usage: TokenUsage | null;
  /** What a media Kind counted. Null or missing for chat, which counts tokens in `usage`. */
  units?: MediaUnits | null;
  requestBytes: number;
  responseBytes: number;
  /** Streams only: until the first event arrived from the upstream. */
  timeToFirstTokenMs: number | null;
  durationMs: number;
  isCancelled: boolean;
  /** In the order they were made. */
  attempts: AttemptRecord[];
  /**
   * Null when no Attempt failed and the request succeeded or was cancelled,
   * and for a caller with neither a valid API Key nor a Playground session.
   */
  errorCapture: ErrorCaptureRecord | null;
}
