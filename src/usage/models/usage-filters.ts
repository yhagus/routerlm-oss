import { and, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { type ErrorOrigin, usageLogs } from "@/db/schemas/index.js";
import type { UsageFilter, UsageStatus } from "../schemas/usage.schema.js";

const FIRST_ERROR_STATUS = 400;

/** The Usage Logs a UsageFilter selects, as a WHERE condition. */
export function whereFilter(filter: UsageFilter): SQL | undefined {
  return and(
    filter.from === undefined ? undefined : gte(usageLogs.createdAt, filter.from),
    filter.to === undefined ? undefined : lt(usageLogs.createdAt, filter.to),
    filter.modelId === undefined ? undefined : inArray(usageLogs.modelId, filter.modelId),
    callerCondition(filter),
    customerCondition(filter),
    filter.status === undefined ? undefined : or(...filter.status.map(statusCondition)),
    filter.errorOrigin === undefined
      ? undefined
      : inArray(usageLogs.errorOrigin, filter.errorOrigin),
    filter.serviceTier === undefined
      ? undefined
      : inArray(usageLogs.serviceTier, filter.serviceTier),
    filter.q === undefined ? undefined : searchCondition(filter.q),
  );
}

/**
 * The Usage Logs whose Model name, API Key name, error code, User-Agent or client IP
 * contains `text`, or whose id is `text`.
 */
function searchCondition(text: string): SQL | undefined {
  const isUsageLogId = z.uuid().safeParse(text).success;
  const pattern = containing(text);
  return or(
    namesOrErrorCodeContain(text),
    ilike(usageLogs.userAgent, pattern),
    ilike(usageLogs.clientIp, pattern),
    isUsageLogId ? eq(usageLogs.id, text) : undefined,
  );
}

/**
 * The Usage Logs whose Model name, API Key name or error code contains `text`, ignoring
 * case. The names are the ones copied at request time (ADR 0024).
 */
export function namesOrErrorCodeContain(text: string): SQL | undefined {
  const pattern = containing(text);
  return or(
    ilike(usageLogs.modelName, pattern),
    ilike(usageLogs.apiKeyName, pattern),
    ilike(usageLogs.errorCode, pattern),
  );
}

/** An ILIKE pattern matching values that contain `text` literally. */
export function containing(text: string): string {
  return `%${escapeLikeWildcards(text)}%`;
}

/** Makes `%`, `_` and `\` match themselves: `\` is Postgres's default LIKE escape. */
function escapeLikeWildcards(text: string): string {
  return text.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}

/**
 * Who sent the request. The Usage page's API Key filter offers the Playground beside the
 * real keys, so picking both means either: listed keys OR the Playground.
 */
export function callerCondition({
  apiKeyId,
  isPlayground,
}: Pick<UsageFilter, "apiKeyId" | "isPlayground">): SQL | undefined {
  const listedKeysCondition =
    apiKeyId === undefined ? undefined : inArray(usageLogs.apiKeyId, apiKeyId);
  if (isPlayground === undefined) return listedKeysCondition;
  const playgroundCondition = eq(usageLogs.isPlayground, isPlayground);
  if (listedKeysCondition === undefined) return playgroundCondition;
  return isPlayground
    ? or(listedKeysCondition, playgroundCondition)
    : and(listedKeysCondition, playgroundCondition);
}

/** The Usage Logs of these Integrations' or this Customer's API Keys, copied at request time. */
export function customerCondition({
  integrationId,
  customerId,
}: Pick<UsageFilter, "integrationId" | "customerId">): SQL | undefined {
  return and(
    integrationId === undefined ? undefined : inArray(usageLogs.integrationId, integrationId),
    customerId === undefined ? undefined : eq(usageLogs.customerId, customerId),
  );
}

/**
 * Failed Usage Logs of one Error Origin. Failures recorded before Error
 * Origins existed have none, so they match no origin.
 */
export function failedWithOriginCondition(origin: ErrorOrigin): SQL | undefined {
  return and(statusCondition("failed"), eq(usageLogs.errorOrigin, origin));
}

export function statusCondition(status: UsageStatus): SQL | undefined {
  switch (status) {
    case "cancelled":
      return eq(usageLogs.isCancelled, true);
    case "failed":
      return and(
        eq(usageLogs.isCancelled, false),
        or(isNotNull(usageLogs.errorCode), gte(usageLogs.httpStatus, FIRST_ERROR_STATUS)),
      );
    case "succeeded":
      return and(
        eq(usageLogs.isCancelled, false),
        isNull(usageLogs.errorCode),
        lt(usageLogs.httpStatus, FIRST_ERROR_STATUS),
      );
  }
}
