import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { SERVICE_TIERS } from "@/inference/models/internal-format.js";
import { at, createdAt, id } from "./columns.js";
import { MODEL_KINDS, type ModelKind } from "./upstream.js";

// Records, written by the worker. Usage Logs and Attempts hold measurements,
// and a snapshot of what served them (ADR 0024): plain ids with no foreign
// key, and the names of that configuration as they were at request time, so
// editing or deleting it never rewrites history. Any other free text or JSON
// column here would break ADR 0004; tests/usage/records-schema.test.ts fails
// if one is added. Error Captures are the one exception.

export const CLIENT_PROTOCOLS = [
  "openai-chat",
  "anthropic-messages",
  "openai-responses",
  "openai-images",
  "openai-videos",
  "openai-speech",
  "openai-transcription",
] as const;
export type ClientProtocol = (typeof CLIENT_PROTOCOLS)[number];

/** The Model Kind each client Protocol's endpoint serves: a Model of another Kind is refused there. */
export const CLIENT_PROTOCOL_KINDS = {
  "openai-chat": "chat",
  "anthropic-messages": "chat",
  "openai-responses": "chat",
  "openai-images": "image",
  "openai-videos": "video",
  "openai-speech": "speech",
  "openai-transcription": "transcription",
} as const satisfies Record<ClientProtocol, ModelKind>;

/**
 * The error contract's codes, as the client receives them. Each code needs a
 * row in web/content/docs/9.errors.md and web/content/docs-id/9.errors.md;
 * tests/docs/client-examples.test.ts fails on a missing one.
 */
export const GATEWAY_ERROR_CODES = [
  "invalid_request",
  "no_capable_route",
  "invalid_api_key",
  "model_not_allowed",
  "model_not_found",
  "request_too_large",
  "upstream_rate_limited",
  "upstream_error",
  "upstream_timeout",
  // A video id the gateway didn't issue to this caller, or whose job is gone.
  "video_not_found",
  // A Video Job's content asked for before it completed.
  "video_not_ready",
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

/** Why one Attempt failed, one per row of the Fallback table. */
export const ATTEMPT_FAILURE_REASONS = [
  "rate_limited",
  "server_error",
  "timeout",
  "connection_error",
  "unauthorized",
  "bad_request",
  "stream_interrupted",
  // The Provider's Quota Meter ran out (GLOSSARY "Exhausted").
  "exhausted",
] as const;
export type AttemptFailureReason = (typeof ATTEMPT_FAILURE_REASONS)[number];

/** How a recorded Attempt ended badly: a Fallback reason, or the client went away during it. */
export const RECORDED_ATTEMPT_FAILURES = [...ATTEMPT_FAILURE_REASONS, "cancelled"] as const;
export type RecordedAttemptFailure = (typeof RECORDED_ATTEMPT_FAILURES)[number];

/**
 * Who caused a failed request: the client, a Provider, or the gateway itself
 * (GLOSSARY "Error Origin", ADR 0031). Null for successful and cancelled requests.
 */
export const ERROR_ORIGINS = ["client", "upstream", "gateway"] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

/**
 * A 64-bit PostgreSQL transaction id (`xid8`), read as a decimal string: it
 * does not fit a JS number exactly.
 */
const transactionId = customType<{ data: string; driverData: string }>({
  dataType: () => "xid8",
});

/** A longer User-Agent is truncated to this many characters before it is recorded (ADR 0032). */
export const USER_AGENT_MAX_LENGTH = 512;

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: id(),
    // When the gateway received the request; the Usage page filters on it.
    createdAt: at("created_at").notNull(),
    // At most one of apiKeyId and userId is set: a client request has an API
    // Key, a Playground request a User, a request refused before its key was
    // known neither. Either may point at a row deleted since. A User's name or
    // email is never copied, so it does not outlive their account.
    apiKeyId: uuid("api_key_id"),
    apiKeyName: text("api_key_name"),
    // The Integration that issued the API Key and the Customer it names, copied
    // at request time like the key's name; null for a key no Integration issued.
    integrationId: uuid("integration_id"),
    integrationName: text("integration_name"),
    customerId: text("customer_id"),
    // The transaction that wrote the row, then the order it was inserted in:
    // an Integration pulls its Usage Logs after a cursor on the pair. Only
    // rows of transactions older than every one still running are pulled, so
    // a row committed late never lands behind the cursor (created_at is the
    // request time, and rows commit late). Both read as decimal strings.
    sequence: bigint("sequence", { mode: "string" }).notNull().generatedAlwaysAsIdentity(),
    transactionId: transactionId("transaction_id")
      .notNull()
      .default(sql`pg_current_xact_id()`),
    userId: uuid("user_id"),
    isPlayground: boolean("is_playground").notNull().default(false),
    modelId: uuid("model_id"),
    modelName: text("model_name"),
    // What served the request; null if nothing did. A Route has no name.
    routeId: uuid("route_id"),
    upstreamModelId: uuid("upstream_model_id"),
    // As the Provider spells it in requests.
    upstreamModelName: text("upstream_model_name"),
    providerSlug: text("provider_slug"),
    providerAccountId: uuid("provider_account_id"),
    providerAccountName: text("provider_account_name"),
    // The Kind of the client endpoint the request came to (CLIENT_PROTOCOL_KINDS).
    kind: text("kind", { enum: MODEL_KINDS }).notNull().default("chat"),
    clientProtocol: text("client_protocol", { enum: CLIENT_PROTOCOLS }).notNull(),
    isStreamed: boolean("is_streamed").notNull(),
    httpStatus: integer("http_status").notNull(),
    errorCode: text("error_code", { enum: GATEWAY_ERROR_CODES }),
    errorOrigin: text("error_origin", { enum: ERROR_ORIGINS }),
    // Who sent the request and from where (ADR 0032); null on rows recorded
    // before they were. The IP is the one resolved through TRUST_PROXY.
    userAgent: text("user_agent"),
    clientIp: text("client_ip"),
    // Null when the upstream didn't report the count; isIncomplete is then set.
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    // The units a media Kind counts; null for chat, and for a unit the Kind doesn't count.
    imagesOut: integer("images_out"),
    imagesIn: integer("images_in"),
    outputSeconds: integer("output_seconds"),
    audioSeconds: numeric("audio_seconds", { precision: 12, scale: 3, mode: "number" }),
    characters: integer("characters"),
    // The size or resolution that priced the units, such as `2K` or `720P`.
    unitTier: text("unit_tier"),
    requestBytes: integer("request_bytes").notNull(),
    responseBytes: integer("response_bytes").notNull(),
    // The Service Tier that served the request; null for the Provider's default.
    serviceTier: text("service_tier", { enum: SERVICE_TIERS }),
    // USD, from the Upstream Model's prices at request time. Null if unknown.
    cost: numeric("cost", { precision: 18, scale: 10, mode: "number" }),
    timeToFirstTokenMs: integer("time_to_first_token_ms"),
    durationMs: integer("duration_ms").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    isIncomplete: boolean("is_incomplete").notNull().default(false),
  },
  (table) => [
    index("usage_logs_created_at_idx").on(table.createdAt),
    index("usage_logs_api_key_id_created_at_idx").on(table.apiKeyId, table.createdAt),
    index("usage_logs_model_id_created_at_idx").on(table.modelId, table.createdAt),
    index("usage_logs_upstream_model_id_created_at_idx").on(table.upstreamModelId, table.createdAt),
    // The Usage page filters, and the Overview counts, failed requests by origin.
    index("usage_logs_error_origin_created_at_idx").on(table.errorOrigin, table.createdAt),
    // An Integration's usage pull: its logs after a (transaction, sequence) cursor.
    index("usage_logs_integration_id_transaction_id_sequence_idx").on(
      table.integrationId,
      table.transactionId,
      table.sequence,
    ),
  ],
);

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    usageLogId: uuid("usage_log_id")
      .notNull()
      .references(() => usageLogs.id, { onDelete: "cascade" }),
    // Orders the Attempts of one request.
    startedAt: at("started_at").notNull(),
    // The Usage Log's Model, API Key, Integration and Customer, and the target
    // this Attempt tried, copied as the Usage Log copies them, plus the
    // Provider's display name for the Error Captures list.
    modelName: text("model_name"),
    apiKeyName: text("api_key_name"),
    integrationName: text("integration_name"),
    customerId: text("customer_id"),
    routeId: uuid("route_id"),
    upstreamModelId: uuid("upstream_model_id"),
    upstreamModelName: text("upstream_model_name"),
    providerSlug: text("provider_slug"),
    providerName: text("provider_name"),
    providerAccountId: uuid("provider_account_id"),
    providerAccountName: text("provider_account_name"),
    // Null when no response arrived (timeout or connection error).
    upstreamStatus: integer("upstream_status"),
    // Null for the Attempt that succeeded.
    failureReason: text("failure_reason", { enum: RECORDED_ATTEMPT_FAILURES }),
    // The request id the Provider returned, for its support; null when it
    // returned none or no response arrived.
    upstreamRequestId: text("upstream_request_id"),
    durationMs: integer("duration_ms").notNull(),
  },
  (table) => [index("attempts_usage_log_id_idx").on(table.usageLogId)],
);

export const errorCaptures = pgTable(
  "error_captures",
  {
    id: id(),
    createdAt: createdAt(),
    usageLogId: uuid("usage_log_id")
      .notNull()
      .references(() => usageLogs.id, { onDelete: "cascade" }),
    // Null when this captures the failed client request rather than one Attempt.
    attemptId: uuid("attempt_id").references(() => attempts.id, { onDelete: "cascade" }),
    // Credentials are redacted and bodies over 256 KB truncated, with a marker,
    // before they are written.
    requestHeaders: jsonb("request_headers").$type<Record<string, string>>().notNull(),
    requestBody: text("request_body").notNull(),
    responseHeaders: jsonb("response_headers").$type<Record<string, string>>(),
    responseBody: text("response_body"),
    // Copied from the Usage Log, so a capture is complete on its own (ADR 0032).
    userAgent: text("user_agent"),
    clientIp: text("client_ip"),
  },
  (table) => [
    // The retention job deletes by age.
    index("error_captures_created_at_idx").on(table.createdAt),
    index("error_captures_usage_log_id_idx").on(table.usageLogId),
  ],
);
