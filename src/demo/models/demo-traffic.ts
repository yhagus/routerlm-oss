import { randomUUID } from 'node:crypto';
import type {
  AttemptFailureReason,
  attempts,
  errorCaptures,
  FinishReason,
  GatewayErrorCode,
  usageLogs,
} from '@/db/schemas';
import type { ReasoningEffort, TokenUsage } from '@/inference/models/internal-format';
import { REDACTED } from '@/error-captures/models/captured-content';
import { SECOND_MS } from '@/libs/models/duration';
import { usageMeasurementsOf } from '@/usage/models/usage-measurements';
import type { RequestNames, ServingTarget, UpstreamModelPrices } from '@/usage/models/usage-job';
import {
  type DemoCaller,
  DEMO_MODEL_NAMES,
  type DemoModelName,
  type TrafficProfile,
} from '@/demo/data/demo-fixtures';
import { between, logNormal, pickWeighted, type Random, seededRandom } from './seeded-random';

type NewUsageLog = typeof usageLogs.$inferInsert;
type NewAttempt = typeof attempts.$inferInsert;
type NewErrorCapture = typeof errorCaptures.$inferInsert;

export interface TrafficProviderAccount {
  id: string;
  name: string;
}

export interface TrafficRoute {
  routeId: string;
  upstreamModelRowId: string;
  upstreamModelName: string;
  providerSlug: string;
  providerName: string;
  prices: UpstreamModelPrices;
  providerAccounts: TrafficProviderAccount[];
}

export interface TrafficModel {
  modelId: string;
  modelName: string;
  profile: TrafficProfile;
  routes: TrafficRoute[];
}

export type TrafficSource =
  | { kind: 'api-key'; apiKeyId: string; apiKeyName: string }
  | { kind: 'playground'; userId: string };

export interface TrafficCaller {
  source: TrafficSource;
  caller: DemoCaller;
}

export interface DemoTraffic {
  usageLogs: NewUsageLog[];
  attempts: NewAttempt[];
  errorCaptures: NewErrorCapture[];
}

export const DEMO_REQUEST_COUNT = 1_750;

const DEMO_SEED = 20_261_116;

const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;
const TRAFFIC_WINDOW_MS = 7 * DAY_MS;

const HOURLY_WEIGHTS = [
  0.08, 0.06, 0.05, 0.05, 0.06, 0.1, 0.2, 0.4, 0.7, 0.95, 1, 1, 0.85, 0.95, 1, 1, 0.95, 0.8, 0.6,
  0.45, 0.35, 0.25, 0.18, 0.12,
];
const WEEKEND_WEIGHT = 0.3;
const SUNDAY = 0;
const SATURDAY = 6;

const FAILED_SHARE = 0.015;
const RECOVERED_SHARE = 0.035;
const MAX_ERROR_CAPTURES = 8;

const FIRST_TOKEN_TIMEOUT_MS = 60 * SECOND_MS;

const CACHED_REQUEST_SHARE = 0.8;
const CACHE_WRITE_REQUEST_SHARE = 0.25;
const CACHE_WRITE_SHARE_OF_UNCACHED = 0.3;
const MAX_CACHE_READ_SHARE = 0.9;
const BYTES_PER_TOKEN = 4;
const REQUEST_ENVELOPE_BYTES = 400;
const RESPONSE_ENVELOPE_BYTES = 300;
const ERROR_RESPONSE_BYTES = 180;
const TOOL_REQUEST_SHARE = 0.45;
const MAX_TOOL_COUNT = 12;
const TOOL_CALL_SHARE = 0.55;
const MAX_TOOL_CALL_COUNT = 3;
const OUTPUT_LIMIT_HIT_SHARE = 0.03;
const SENT_OUTPUT_LIMIT_SHARE = 0.6;
const SENT_OUTPUT_LIMITS = [4_096, 8_192, 16_384, 32_000];
const SENT_REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
const STREAMED_REASONING_SHARE = 0.5;

type Outcome = 'served' | 'recovered' | 'failed';
type FallbackFailure = Extract<AttemptFailureReason, 'rate_limited' | 'server_error' | 'timeout'>;

const FAILURE_WEIGHTS = [
  { value: 'rate_limited', weight: 5 },
  { value: 'server_error', weight: 3 },
  { value: 'timeout', weight: 1 },
] as const satisfies readonly { value: FallbackFailure; weight: number }[];

const SERVER_ERROR_STATUSES = [500, 502, 503];

const GATEWAY_ERRORS: Record<FallbackFailure, { httpStatus: number; errorCode: GatewayErrorCode }> =
  {
    rate_limited: { httpStatus: 429, errorCode: 'upstream_rate_limited' },
    server_error: { httpStatus: 502, errorCode: 'upstream_error' },
    timeout: { httpStatus: 504, errorCode: 'upstream_timeout' },
  };

interface Candidate {
  route: TrafficRoute;
  providerAccount: TrafficProviderAccount;
}

interface FailedAttempt {
  attempt: NewAttempt;
  failure: FallbackFailure;
  candidate: Candidate;
}

export function generateDemoTraffic(
  now: Date,
  models: ReadonlyMap<DemoModelName, TrafficModel>,
  callers: TrafficCaller[],
): DemoTraffic {
  const random = seededRandom(DEMO_SEED);
  const traffic: DemoTraffic = { usageLogs: [], attempts: [], errorCaptures: [] };
  const failures: { usageLog: NewUsageLog; failed: FailedAttempt; caller: DemoCaller }[] = [];

  for (const createdAt of requestTimes(random, now)) {
    const { source, caller } = pickWeighted(
      random,
      callers.map((entry) => ({ value: entry, weight: entry.caller.weight })),
    );
    const model = modelFor(random, caller, models);
    const outcome = pickOutcome(random);
    const candidates = model.routes.flatMap((route) =>
      route.providerAccounts.map((providerAccount) => ({ route, providerAccount })),
    );
    const requestNames: RequestNames = {
      modelName: model.modelName,
      apiKeyName: source.kind === 'api-key' ? source.apiKeyName : null,
    };
    const isStreamed = random() < caller.streamedShare;
    const toolCount = random() < TOOL_REQUEST_SHARE ? between(random, 1, MAX_TOOL_COUNT) : 0;
    const usageLogId = randomUUID();

    const failedAttemptCount = failedAttemptCountFor(random, outcome, candidates.length);
    const failedAttempts: FailedAttempt[] = [];
    let elapsedMs = 0;
    for (const candidate of candidates.slice(0, failedAttemptCount)) {
      const failed = failedAttempt(
        random,
        usageLogId,
        requestNames,
        candidate,
        new Date(createdAt.getTime() + elapsedMs),
      );
      failedAttempts.push(failed);
      elapsedMs += failed.attempt.durationMs;
    }
    traffic.attempts.push(...failedAttempts.map((failed) => failed.attempt));

    const base = {
      id: usageLogId,
      createdAt,
      ...attribution(source),
      ...requestNames,
      requestedModelName: model.modelName,
      modelId: model.modelId,
      clientProtocol: caller.clientProtocol,
      isStreamed,
      toolCount,
      attemptCount: failedAttempts.length,
      userAgent: caller.userAgent,
      clientIp: caller.clientIp,
    };

    const lastFailure = failedAttempts.at(-1);
    if (outcome === 'failed' && lastFailure) {
      const usageLog: NewUsageLog = {
        ...base,
        ...GATEWAY_ERRORS[lastFailure.failure],
        errorOrigin: 'upstream',
        requestBytes: requestBytesFor(model.profile.contextTokens),
        responseBytes: ERROR_RESPONSE_BYTES,
        durationMs: elapsedMs,
      };
      traffic.usageLogs.push(usageLog);
      failures.push({ usageLog, failed: lastFailure, caller });
      continue;
    }

    const serving = candidates[failedAttemptCount];
    const tokens = tokenUsage(random, model.profile);
    const firstTokenMs = Math.round(model.profile.firstTokenMs * logNormal(random, 1, 0.35));
    const generationMs = Math.round(
      ((tokens.outputTokens ?? 0) / model.profile.outputTokensPerSecond) * SECOND_MS,
    );
    const servingMs = firstTokenMs + generationMs;
    traffic.attempts.push({
      id: randomUUID(),
      usageLogId,
      ...requestNames,
      ...servingTargetOf(serving),
      startedAt: new Date(createdAt.getTime() + elapsedMs),
      upstreamStatus: 200,
      failureReason: null,
      durationMs: servingMs,
    });
    const measurements = usageMeasurementsOf({ prices: serving.route.prices }, tokens);
    traffic.usageLogs.push({
      ...base,
      ...measurements,
      attemptCount: base.attemptCount + 1,
      ...usageLogTargetOf(serving),
      httpStatus: 200,
      requestBytes: requestBytesFor(contextTokensOf(tokens)),
      responseBytes: (tokens.outputTokens ?? 0) * BYTES_PER_TOKEN + RESPONSE_ENVELOPE_BYTES,
      timeToFirstTokenMs: isStreamed ? elapsedMs + firstTokenMs : null,
      ...responseShapeOf(random, { isStreamed, toolCount, tokens, profile: model.profile }),
      durationMs: elapsedMs + servingMs,
    });
  }

  traffic.errorCaptures = failures
    .slice(-MAX_ERROR_CAPTURES)
    .map(({ usageLog, failed, caller }) => errorCaptureOf(usageLog, failed, caller));
  return traffic;
}

function requestTimes(random: Random, now: Date): Date[] {
  const times: Date[] = [];
  const windowStart = now.getTime() - TRAFFIC_WINDOW_MS;
  while (times.length < DEMO_REQUEST_COUNT) {
    const candidate = new Date(windowStart + random() * TRAFFIC_WINDOW_MS);
    if (random() < trafficWeightAt(candidate)) {
      times.push(candidate);
    }
  }
  return times.sort((first, second) => first.getTime() - second.getTime());
}

function trafficWeightAt(time: Date): number {
  const day = time.getUTCDay();
  const isWeekend = day === SATURDAY || day === SUNDAY;
  return HOURLY_WEIGHTS[time.getUTCHours()] * (isWeekend ? WEEKEND_WEIGHT : 1);
}

function modelFor(
  random: Random,
  caller: DemoCaller,
  models: ReadonlyMap<DemoModelName, TrafficModel>,
): TrafficModel {
  const mix = DEMO_MODEL_NAMES.map((name) => ({ value: name, weight: caller.models[name] ?? 0 }));
  const name = pickWeighted(random, mix);
  const model = models.get(name);
  if (!model) {
    throw new Error(
      `Demo caller "${caller.apiKeyName ?? 'Playground'}" uses unknown Model ${name}`,
    );
  }
  return model;
}

function pickOutcome(random: Random): Outcome {
  const draw = random();
  if (draw < FAILED_SHARE) return 'failed';
  if (draw < FAILED_SHARE + RECOVERED_SHARE) return 'recovered';
  return 'served';
}

function failedAttemptCountFor(random: Random, outcome: Outcome, candidateCount: number): number {
  if (outcome === 'served') return 0;
  if (outcome === 'recovered') return 1;
  return Math.min(between(random, 2, 3), candidateCount);
}

function failedAttempt(
  random: Random,
  usageLogId: string,
  requestNames: RequestNames,
  candidate: Candidate,
  startedAt: Date,
): FailedAttempt {
  const failure = pickWeighted(random, FAILURE_WEIGHTS);
  return {
    failure,
    candidate,
    attempt: {
      id: randomUUID(),
      usageLogId,
      ...requestNames,
      ...servingTargetOf(candidate),
      startedAt,
      upstreamStatus: upstreamStatusFor(random, failure),
      failureReason: failure,
      durationMs: failedAttemptDurationMs(random, failure),
    },
  };
}

function upstreamStatusFor(random: Random, failure: FallbackFailure): number | null {
  switch (failure) {
    case 'rate_limited':
      return 429;
    case 'server_error':
      return SERVER_ERROR_STATUSES[between(random, 0, SERVER_ERROR_STATUSES.length - 1)];
    case 'timeout':
      return null;
  }
}

function failedAttemptDurationMs(random: Random, failure: FallbackFailure): number {
  switch (failure) {
    case 'rate_limited':
      return between(random, 120, 600);
    case 'server_error':
      return between(random, 400, 3_000);
    case 'timeout':
      return FIRST_TOKEN_TIMEOUT_MS;
  }
}

function servingTargetOf(candidate: Candidate): ServingTarget {
  return { ...usageLogTargetOf(candidate), providerName: candidate.route.providerName };
}

function usageLogTargetOf({
  route,
  providerAccount,
}: Candidate): Omit<ServingTarget, 'providerName'> {
  return {
    routeId: route.routeId,
    upstreamModelId: route.upstreamModelRowId,
    upstreamModelName: route.upstreamModelName,
    providerSlug: route.providerSlug,
    providerAccountId: providerAccount.id,
    providerAccountName: providerAccount.name,
  };
}

function attribution(
  source: TrafficSource,
): Pick<NewUsageLog, 'apiKeyId' | 'userId' | 'isPlayground'> {
  return source.kind === 'api-key'
    ? { apiKeyId: source.apiKeyId, userId: null, isPlayground: false }
    : { apiKeyId: null, userId: source.userId, isPlayground: true };
}

function tokenUsage(random: Random, profile: TrafficProfile): TokenUsage {
  const contextTokens = Math.max(50, Math.round(logNormal(random, profile.contextTokens, 0.6)));
  const cacheReadShare =
    random() < CACHED_REQUEST_SHARE
      ? Math.min(MAX_CACHE_READ_SHARE, profile.cacheReadShare * (0.5 + random()))
      : 0;
  const cacheReadTokens = Math.round(contextTokens * cacheReadShare);
  const cacheWriteTokens =
    random() < CACHE_WRITE_REQUEST_SHARE
      ? Math.round((contextTokens - cacheReadTokens) * CACHE_WRITE_SHARE_OF_UNCACHED)
      : 0;
  const outputTokens = Math.max(1, Math.round(logNormal(random, profile.outputTokens, 0.7)));
  return {
    inputTokens: contextTokens - cacheReadTokens - cacheWriteTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: Math.round(outputTokens * profile.reasoningShare),
  };
}

function responseShapeOf(
  random: Random,
  request: { isStreamed: boolean; toolCount: number; tokens: TokenUsage; profile: TrafficProfile },
): Pick<
  NewUsageLog,
  'isReasoningStreamed' | 'finishReason' | 'maxOutputTokens' | 'reasoningEffort' | 'toolCallCount'
> {
  const { isStreamed, toolCount, tokens, profile } = request;
  const toolCallCount =
    toolCount > 0 && random() < TOOL_CALL_SHARE ? between(random, 1, MAX_TOOL_CALL_COUNT) : 0;
  const isReasoning = profile.reasoningShare > 0;
  return {
    isReasoningStreamed:
      isStreamed && (tokens.reasoningTokens ?? 0) > 0 && random() < STREAMED_REASONING_SHARE,
    finishReason: finishReasonFor(random, toolCallCount),
    maxOutputTokens:
      random() < SENT_OUTPUT_LIMIT_SHARE ? pickOne(random, SENT_OUTPUT_LIMITS) : null,
    reasoningEffort: isReasoning ? pickOne(random, SENT_REASONING_EFFORTS) : null,
    toolCallCount,
  };
}

function finishReasonFor(random: Random, toolCallCount: number): FinishReason {
  if (toolCallCount > 0) {
    return 'tool_calls';
  }
  return random() < OUTPUT_LIMIT_HIT_SHARE ? 'length' : 'stop';
}

function pickOne<T>(random: Random, values: readonly T[]): T {
  return values[between(random, 0, values.length - 1)];
}

function contextTokensOf(tokens: TokenUsage): number {
  return (tokens.inputTokens ?? 0) + (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0);
}

function requestBytesFor(contextTokens: number): number {
  return contextTokens * BYTES_PER_TOKEN + REQUEST_ENVELOPE_BYTES;
}

function errorCaptureOf(
  usageLog: NewUsageLog,
  failed: FailedAttempt,
  caller: DemoCaller,
): NewErrorCapture {
  return {
    createdAt: failed.attempt.startedAt,
    usageLogId: failed.attempt.usageLogId,
    attemptId: failed.attempt.id,
    userAgent: caller.userAgent,
    clientIp: caller.clientIp,
    requestHeaders: {
      authorization: REDACTED,
      'content-type': 'application/json',
      'user-agent': caller.userAgent,
    },
    requestBody: JSON.stringify({
      model: failed.candidate.route.upstreamModelName,
      stream: usageLog.isStreamed,
      messages: [
        {
          role: 'system',
          content: 'You are a careful release assistant for the Acme Widgets team.',
        },
        { role: 'user', content: 'Summarise the failing checks in build 4821 for the changelog.' },
      ],
    }),
    responseHeaders:
      failed.attempt.upstreamStatus === null ? null : responseHeadersFor(failed.failure),
    responseBody: failed.attempt.upstreamStatus === null ? null : responseBodyFor(failed.failure),
  };
}

function responseHeadersFor(failure: FallbackFailure): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (failure === 'rate_limited') headers['retry-after'] = '20';
  return headers;
}

function responseBodyFor(failure: FallbackFailure): string {
  const error =
    failure === 'rate_limited'
      ? { type: 'rate_limit_error', message: 'Rate limit reached for requests per minute.' }
      : { type: 'server_error', message: 'The server had an error while processing your request.' };
  return JSON.stringify({ error });
}
