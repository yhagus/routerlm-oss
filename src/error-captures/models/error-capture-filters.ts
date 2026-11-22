import { and, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { attempts, errorCaptures, usageLogs } from "@/db/schemas/index.js";
import {
  callerCondition,
  containing,
  customerCondition,
  namesOrErrorCodeContain,
} from "@/usage/models/usage-filters.js";
import type {
  CaptureOutcome,
  ErrorCapturePageQuery,
  FailedHopKind,
} from "@/error-captures/schemas/error-capture-page-query.schema.js";

const FIRST_ERROR_STATUS = 400;

/**
 * The Error Captures a page query selects, as a WHERE condition over captures
 * joined to their Usage Log and left-joined to their Attempt.
 */
export function whereErrorCaptureFilter(query: ErrorCapturePageQuery): SQL | undefined {
  return and(
    query.usageLogId === undefined ? undefined : eq(errorCaptures.usageLogId, query.usageLogId),
    query.from === undefined ? undefined : gte(errorCaptures.createdAt, query.from),
    query.to === undefined ? undefined : lt(errorCaptures.createdAt, query.to),
    query.modelId === undefined ? undefined : inArray(usageLogs.modelId, query.modelId),
    callerCondition(query),
    customerCondition(query),
    query.errorOrigin === undefined ? undefined : inArray(usageLogs.errorOrigin, query.errorOrigin),
    query.failedAt === undefined ? undefined : or(...query.failedAt.map(failedAtCondition)),
    query.providerAccountId === undefined
      ? undefined
      : inArray(attempts.providerAccountId, query.providerAccountId),
    query.failureReason === undefined
      ? undefined
      : inArray(attempts.failureReason, query.failureReason),
    query.outcome === undefined ? undefined : or(...query.outcome.map(outcomeCondition)),
    query.q === undefined ? undefined : searchCondition(query.q),
  );
}

function failedAtCondition(hop: FailedHopKind): SQL {
  switch (hop) {
    case "client-to-gateway":
      return isNull(errorCaptures.attemptId);
    case "gateway-to-provider-account":
      return isNotNull(errorCaptures.attemptId);
  }
}

/** Matches `clientOutcome` on the web: recovered means the client got a success. */
function outcomeCondition(outcome: CaptureOutcome): SQL | undefined {
  switch (outcome) {
    case "recovered":
      return and(isNull(usageLogs.errorCode), lt(usageLogs.httpStatus, FIRST_ERROR_STATUS));
    case "failed":
      return or(isNotNull(usageLogs.errorCode), gte(usageLogs.httpStatus, FIRST_ERROR_STATUS));
  }
}

/**
 * Captures whose Model name, API Key name, error code, User-Agent, client IP or
 * upstream request id contains `text`, ignoring case.
 */
function searchCondition(text: string): SQL | undefined {
  const pattern = containing(text);
  return or(
    namesOrErrorCodeContain(text),
    ilike(errorCaptures.userAgent, pattern),
    ilike(errorCaptures.clientIp, pattern),
    ilike(attempts.upstreamRequestId, pattern),
  );
}
