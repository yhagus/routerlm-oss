import { boolean, index, integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { apiKeys, users } from "./access.js";
import { at, createdAt, id } from "./columns.js";
import { routes, models } from "./routing.js";
import { providerAccounts } from "./upstream.js";

// Records, written by the worker. Usage Logs and Attempts hold measurements
// only; any free text or JSON column here would break ADR 0004, and
// schema.spec.ts fails if one is added. Error Captures are the one exception.

export const CLIENT_PROTOCOLS = ["openai-chat", "anthropic-messages", "openai-responses"] as const;
export type ClientProtocol = (typeof CLIENT_PROTOCOLS)[number];

/** The error contract's codes, as the client receives them. */
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

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: id(),
    // When the gateway received the request; the Usage page filters on it.
    createdAt: at("created_at").notNull(),
    // Exactly one of apiKeyId and userId is set when written: a client
    // request has an API Key, a Playground request a User. Both become null
    // if that key or User is deleted; isPlayground keeps the distinction.
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    isPlayground: boolean("is_playground").notNull().default(false),
    modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
    // The Route and Provider Account that served the request; null if none did.
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id, {
      onDelete: "set null",
    }),
    clientProtocol: text("client_protocol", { enum: CLIENT_PROTOCOLS }).notNull(),
    isStreamed: boolean("is_streamed").notNull(),
    httpStatus: integer("http_status").notNull(),
    errorCode: text("error_code", { enum: GATEWAY_ERROR_CODES }),
    // Null when the upstream didn't report the count; isIncomplete is then set.
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    requestBytes: integer("request_bytes").notNull(),
    responseBytes: integer("response_bytes").notNull(),
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
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    providerAccountId: uuid("provider_account_id").references(() => providerAccounts.id, {
      onDelete: "set null",
    }),
    // Null when no response arrived (timeout or connection error).
    upstreamStatus: integer("upstream_status"),
    // Null for the Attempt that succeeded.
    failureReason: text("failure_reason", { enum: RECORDED_ATTEMPT_FAILURES }),
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
  },
  (table) => [
    // The retention job deletes by age.
    index("error_captures_created_at_idx").on(table.createdAt),
    index("error_captures_usage_log_id_idx").on(table.usageLogId),
  ],
);
