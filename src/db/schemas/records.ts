import { sql } from 'drizzle-orm';
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
} from 'drizzle-orm/pg-core';
import { SERVICE_TIERS } from '@/inference/models/internal-format';
import { at, createdAt, id } from './columns';
import { MODEL_KINDS, type ModelKind, UPSTREAM_PROTOCOLS } from './upstream';

export const CLIENT_PROTOCOLS = [
  'openai-chat',
  'anthropic-messages',
  'openai-responses',
  'openai-images',
  'openai-videos',
  'openai-speech',
  'openai-transcription',
] as const;
export type ClientProtocol = (typeof CLIENT_PROTOCOLS)[number];

export const CLIENT_PROTOCOL_KINDS = {
  'openai-chat': 'chat',
  'anthropic-messages': 'chat',
  'openai-responses': 'chat',
  'openai-images': 'image',
  'openai-videos': 'video',
  'openai-speech': 'speech',
  'openai-transcription': 'transcription',
} as const satisfies Record<ClientProtocol, ModelKind>;

export const GATEWAY_ERROR_CODES = [
  'invalid_request',
  'no_capable_route',
  'invalid_api_key',
  'model_not_allowed',
  'model_not_found',
  'request_too_large',
  'upstream_rate_limited',
  'upstream_error',
  'upstream_timeout',
  'video_not_found',
  'video_not_ready',
  'spend_limit_reached',
  'request_rate_exceeded',
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const ATTEMPT_FAILURE_REASONS = [
  'rate_limited',
  'server_error',
  'timeout',
  'connection_error',
  'unauthorized',
  'bad_request',
  'stream_interrupted',
  'exhausted',
  'not_in_plan',
] as const;
export type AttemptFailureReason = (typeof ATTEMPT_FAILURE_REASONS)[number];

export const RECORDED_ATTEMPT_FAILURES = [...ATTEMPT_FAILURE_REASONS, 'cancelled'] as const;
export type RecordedAttemptFailure = (typeof RECORDED_ATTEMPT_FAILURES)[number];

export const ERROR_ORIGINS = ['client', 'upstream', 'gateway'] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

const transactionId = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
});

export const USER_AGENT_MAX_LENGTH = 512;

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: id(),
    createdAt: at('created_at').notNull(),
    apiKeyId: uuid('api_key_id'),
    apiKeyName: text('api_key_name'),
    integrationId: uuid('integration_id'),
    integrationName: text('integration_name'),
    customerId: text('customer_id'),
    sequence: bigint('sequence', { mode: 'string' }).notNull().generatedAlwaysAsIdentity(),
    transactionId: transactionId('transaction_id')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    userId: uuid('user_id'),
    isPlayground: boolean('is_playground').notNull().default(false),
    modelId: uuid('model_id'),
    modelName: text('model_name'),
    requestedModelName: text('requested_model_name'),
    routeId: uuid('route_id'),
    upstreamModelId: uuid('upstream_model_id'),
    upstreamModelName: text('upstream_model_name'),
    providerSlug: text('provider_slug'),
    providerAccountId: uuid('provider_account_id'),
    providerAccountName: text('provider_account_name'),
    upstreamProtocol: text('upstream_protocol', { enum: UPSTREAM_PROTOCOLS }),
    kind: text('kind', { enum: MODEL_KINDS }).notNull().default('chat'),
    clientProtocol: text('client_protocol', { enum: CLIENT_PROTOCOLS }).notNull(),
    isStreamed: boolean('is_streamed').notNull(),
    httpStatus: integer('http_status').notNull(),
    errorCode: text('error_code', { enum: GATEWAY_ERROR_CODES }),
    errorOrigin: text('error_origin', { enum: ERROR_ORIGINS }),
    userAgent: text('user_agent'),
    clientIp: text('client_ip'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    imagesOut: integer('images_out'),
    imagesIn: integer('images_in'),
    outputSeconds: integer('output_seconds'),
    audioSeconds: numeric('audio_seconds', { precision: 12, scale: 3, mode: 'number' }),
    characters: integer('characters'),
    unitTier: text('unit_tier'),
    requestBytes: integer('request_bytes').notNull(),
    responseBytes: integer('response_bytes').notNull(),
    serviceTier: text('service_tier', { enum: SERVICE_TIERS }),
    pricingWindowName: text('pricing_window_name'),
    cost: numeric('cost', { precision: 18, scale: 10, mode: 'number' }),
    timeToFirstTokenMs: integer('time_to_first_token_ms'),
    durationMs: integer('duration_ms').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    isCancelled: boolean('is_cancelled').notNull().default(false),
    isIncomplete: boolean('is_incomplete').notNull().default(false),
  },
  (table) => [
    index('usage_logs_created_at_idx').on(table.createdAt),
    index('usage_logs_api_key_id_created_at_idx').on(table.apiKeyId, table.createdAt),
    index('usage_logs_model_id_created_at_idx').on(table.modelId, table.createdAt),
    index('usage_logs_upstream_model_id_created_at_idx').on(table.upstreamModelId, table.createdAt),
    index('usage_logs_error_origin_created_at_idx').on(table.errorOrigin, table.createdAt),
    index('usage_logs_integration_id_transaction_id_sequence_idx').on(
      table.integrationId,
      table.transactionId,
      table.sequence,
    ),
    index('usage_logs_integration_id_customer_id_idx').on(
      table.integrationId,
      table.customerId,
      table.createdAt,
      table.cost,
    ),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    usageLogId: uuid('usage_log_id')
      .notNull()
      .references(() => usageLogs.id, { onDelete: 'cascade' }),
    startedAt: at('started_at').notNull(),
    modelName: text('model_name'),
    apiKeyName: text('api_key_name'),
    integrationName: text('integration_name'),
    customerId: text('customer_id'),
    routeId: uuid('route_id'),
    upstreamModelId: uuid('upstream_model_id'),
    upstreamModelName: text('upstream_model_name'),
    providerSlug: text('provider_slug'),
    providerName: text('provider_name'),
    providerAccountId: uuid('provider_account_id'),
    providerAccountName: text('provider_account_name'),
    upstreamStatus: integer('upstream_status'),
    failureReason: text('failure_reason', { enum: RECORDED_ATTEMPT_FAILURES }),
    upstreamRequestId: text('upstream_request_id'),
    durationMs: integer('duration_ms').notNull(),
  },
  (table) => [index('attempts_usage_log_id_idx').on(table.usageLogId)],
);

export const errorCaptures = pgTable(
  'error_captures',
  {
    id: id(),
    createdAt: createdAt(),
    usageLogId: uuid('usage_log_id')
      .notNull()
      .references(() => usageLogs.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => attempts.id, { onDelete: 'cascade' }),
    upstreamProtocol: text('upstream_protocol', { enum: UPSTREAM_PROTOCOLS }),
    requestHeaders: jsonb('request_headers').$type<Record<string, string>>().notNull(),
    requestBody: text('request_body').notNull(),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
    responseBody: text('response_body'),
    userAgent: text('user_agent'),
    clientIp: text('client_ip'),
  },
  (table) => [
    index('error_captures_created_at_idx').on(table.createdAt),
    index('error_captures_usage_log_id_idx').on(table.usageLogId),
  ],
);
