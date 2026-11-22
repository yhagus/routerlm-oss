import { randomUUID } from "node:crypto";
import type {
  AttemptFailureReason,
  attempts,
  errorCaptures,
  GatewayErrorCode,
  usageLogs,
} from "@/db/schemas/index.js";
import type { TokenUsage } from "@/inference/models/internal-format.js";
import { REDACTED } from "@/error-captures/models/captured-content.js";
import { SECOND_MS } from "@/libs/models/duration.js";
import { usageMeasurementsOf } from "@/usage/models/usage-measurements.js";
import type { RequestNames, ServingTarget, UpstreamModelPrices } from "@/usage/models/usage-job.js";
import {
  type DemoCaller,
  DEMO_MODEL_NAMES,
  type DemoModelName,
  type TrafficProfile,
} from "@/demo/data/demo-fixtures.js";
import { between, logNormal, pickWeighted, type Random, seededRandom } from "./seeded-random.js";

type NewUsageLog = typeof usageLogs.$inferInsert;
type NewAttempt = typeof attempts.$inferInsert;
type NewErrorCapture = typeof errorCaptures.$inferInsert;

/** A seeded Provider Account, as Usage Logs and Attempts copy it. */
export interface TrafficProviderAccount {
  id: string;
  name: string;
}

/** One Route of a seeded Model, with the rows it points at. */
export interface TrafficRoute {
  routeId: string;
  /** The `upstream_models` row id. */
  upstreamModelRowId: string;
  /** The model name as the Provider spells it. */
  upstreamModelName: string;
  providerSlug: string;
  /** The Provider's display name. */
  providerName: string;
  prices: UpstreamModelPrices;
  /** Its Provider's accounts, in priority order. */
  providerAccounts: TrafficProviderAccount[];
}

export interface TrafficModel {
  modelId: string;
  modelName: string;
  profile: TrafficProfile;
  routes: TrafficRoute[];
}

export type TrafficSource =
  | { kind: "api-key"; apiKeyId: string; apiKeyName: string }
  | { kind: "playground"; userId: string };

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

// Any fixed seed: the same seed draws the same week of traffic on every run.
const DEMO_SEED = 20_261_116;

const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;
const TRAFFIC_WINDOW_MS = 7 * DAY_MS;

// Relative traffic per UTC hour: quiet nights, busy working hours.
const HOURLY_WEIGHTS = [
  0.08, 0.06, 0.05, 0.05, 0.06, 0.1, 0.2, 0.4, 0.7, 0.95, 1, 1, 0.85, 0.95, 1, 1, 0.95, 0.8, 0.6,
  0.45, 0.35, 0.25, 0.18, 0.12,
];
const WEEKEND_WEIGHT = 0.3;
const SUNDAY = 0;
const SATURDAY = 6;

// About 1.5% of requests fail; a few more succeed only after a Fallback.
const FAILED_SHARE = 0.015;
const RECOVERED_SHARE = 0.035;
const MAX_ERROR_CAPTURES = 8;

// The gateway's default first-token timeout, which a timed-out Attempt waits out.
const FIRST_TOKEN_TIMEOUT_MS = 60 * SECOND_MS;

const CACHED_REQUEST_SHARE = 0.8;
const CACHE_WRITE_REQUEST_SHARE = 0.25;
const CACHE_WRITE_SHARE_OF_UNCACHED = 0.3;
const MAX_CACHE_READ_SHARE = 0.9;
const BYTES_PER_TOKEN = 4;
const REQUEST_ENVELOPE_BYTES = 400;
const RESPONSE_ENVELOPE_BYTES = 300;
const ERROR_RESPONSE_BYTES = 180;

type Outcome = "served" | "recovered" | "failed";
type FallbackFailure = Extract<AttemptFailureReason, "rate_limited" | "server_error" | "timeout">;

const FAILURE_WEIGHTS = [
  { value: "rate_limited", weight: 5 },
  { value: "server_error", weight: 3 },
  { value: "timeout", weight: 1 },
] as const satisfies readonly { value: FallbackFailure; weight: number }[];

const SERVER_ERROR_STATUSES = [500, 502, 503];

/** What the client gets when every Attempt failed, after the last one's failure. */
const GATEWAY_ERRORS: Record<FallbackFailure, { httpStatus: number; errorCode: GatewayErrorCode }> =
  {
    rate_limited: { httpStatus: 429, errorCode: "upstream_rate_limited" },
    server_error: { httpStatus: 502, errorCode: "upstream_error" },
    timeout: { httpStatus: 504, errorCode: "upstream_timeout" },
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

/**
 * A week of gateway traffic ending at `now`: Usage Logs with their Attempts,
 * and Error Captures for the latest failures. The same inputs draw the same
 * requests, shifted to `now`.
 */
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
      apiKeyName: source.kind === "api-key" ? source.apiKeyName : null,
    };
    const isStreamed = random() < caller.streamedShare;
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
      modelId: model.modelId,
      clientProtocol: caller.clientProtocol,
      isStreamed,
      attemptCount: failedAttempts.length,
      userAgent: caller.userAgent,
      clientIp: caller.clientIp,
    };

    const lastFailure = failedAttempts.at(-1);
    if (outcome === "failed" && lastFailure) {
      const usageLog: NewUsageLog = {
        ...base,
        ...GATEWAY_ERRORS[lastFailure.failure],
        // Every Fallback failure is the upstream's, as its error code says.
        errorOrigin: "upstream",
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
      durationMs: elapsedMs + servingMs,
    });
  }

  traffic.errorCaptures = failures
    .slice(-MAX_ERROR_CAPTURES)
    .map(({ usageLog, failed, caller }) => errorCaptureOf(usageLog, failed, caller));
  return traffic;
}

/** DEMO_REQUEST_COUNT times in the week before `now`, oldest first, denser in working hours. */
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
      `Demo caller "${caller.apiKeyName ?? "Playground"}" uses unknown Model ${name}`,
    );
  }
  return model;
}

function pickOutcome(random: Random): Outcome {
  const draw = random();
  if (draw < FAILED_SHARE) return "failed";
  if (draw < FAILED_SHARE + RECOVERED_SHARE) return "recovered";
  return "served";
}

/** How many Attempts fail before one serves, or all of them for a failed request (two or three). */
function failedAttemptCountFor(random: Random, outcome: Outcome, candidateCount: number): number {
  if (outcome === "served") return 0;
  if (outcome === "recovered") return 1;
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
    case "rate_limited":
      return 429;
    case "server_error":
      return SERVER_ERROR_STATUSES[between(random, 0, SERVER_ERROR_STATUSES.length - 1)];
    case "timeout":
      return null;
  }
}

function failedAttemptDurationMs(random: Random, failure: FallbackFailure): number {
  switch (failure) {
    case "rate_limited":
      return between(random, 120, 600);
    case "server_error":
      return between(random, 400, 3_000);
    case "timeout":
      return FIRST_TOKEN_TIMEOUT_MS;
  }
}

/** What an Attempt on a candidate tried, as the Attempt copies it (ADR 0024). */
function servingTargetOf(candidate: Candidate): ServingTarget {
  return { ...usageLogTargetOf(candidate), providerName: candidate.route.providerName };
}

/** The part of a candidate's ServingTarget a Usage Log copies: all but the Provider's name. */
function usageLogTargetOf({
  route,
  providerAccount,
}: Candidate): Omit<ServingTarget, "providerName"> {
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
): Pick<NewUsageLog, "apiKeyId" | "userId" | "isPlayground"> {
  return source.kind === "api-key"
    ? { apiKeyId: source.apiKeyId, userId: null, isPlayground: false }
    : { apiKeyId: null, userId: source.userId, isPlayground: true };
}

/** Token counts around the profile's medians. The input count excludes cache reads and writes. */
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

function contextTokensOf(tokens: TokenUsage): number {
  return (tokens.inputTokens ?? 0) + (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0);
}

function requestBytesFor(contextTokens: number): number {
  return contextTokens * BYTES_PER_TOKEN + REQUEST_ENVELOPE_BYTES;
}

/** The failed request's last Attempt as an Error Capture stores it: credentials already redacted. */
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
      "content-type": "application/json",
      "user-agent": caller.userAgent,
    },
    requestBody: JSON.stringify({
      model: failed.candidate.route.upstreamModelName,
      stream: usageLog.isStreamed,
      messages: [
        {
          role: "system",
          content: "You are a careful release assistant for the Acme Widgets team.",
        },
        { role: "user", content: "Summarise the failing checks in build 4821 for the changelog." },
      ],
    }),
    responseHeaders:
      failed.attempt.upstreamStatus === null ? null : responseHeadersFor(failed.failure),
    responseBody: failed.attempt.upstreamStatus === null ? null : responseBodyFor(failed.failure),
  };
}

function responseHeadersFor(failure: FallbackFailure): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (failure === "rate_limited") headers["retry-after"] = "20";
  return headers;
}

function responseBodyFor(failure: FallbackFailure): string {
  const error =
    failure === "rate_limited"
      ? { type: "rate_limit_error", message: "Rate limit reached for requests per minute." }
      : { type: "server_error", message: "The server had an error while processing your request." };
  return JSON.stringify({ error });
}
