import { and, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { z } from "zod";
import { apiKeys, models, usageLogs } from "@/db/schemas/index.js";
import type { UsageFilter, UsageStatus } from "../schemas/usage.schema.js";

const FIRST_ERROR_STATUS = 400;

/** The Usage Logs a UsageFilter selects, as a WHERE condition. */
export function whereFilter(filter: UsageFilter): SQL | undefined {
  return and(
    filter.from === undefined ? undefined : gte(usageLogs.createdAt, filter.from),
    filter.to === undefined ? undefined : lt(usageLogs.createdAt, filter.to),
    filter.modelId === undefined ? undefined : inArray(usageLogs.modelId, filter.modelId),
    callerCondition(filter),
    filter.status === undefined ? undefined : or(...filter.status.map(statusCondition)),
    filter.serviceTier === undefined
      ? undefined
      : inArray(usageLogs.serviceTier, filter.serviceTier),
    filter.q === undefined ? undefined : searchCondition(filter.q),
  );
}

/** The Usage Logs whose Model name, API Key name or error code contains `text`, or whose id is `text`. */
function searchCondition(text: string): SQL | undefined {
  const isUsageLogId = z.uuid().safeParse(text).success;
  return or(namesOrErrorCodeContain(text), isUsageLogId ? eq(usageLogs.id, text) : undefined);
}

/**
 * The Usage Logs whose Model name, API Key name or error code contains `text`, ignoring
 * case. Subselects rather than joins, so it works in queries that don't join those tables.
 */
export function namesOrErrorCodeContain(text: string): SQL | undefined {
  const pattern = `%${escapeLikeWildcards(text)}%`;
  const queryBuilder = new QueryBuilder();
  return or(
    inArray(
      usageLogs.modelId,
      queryBuilder.select({ id: models.id }).from(models).where(ilike(models.name, pattern)),
    ),
    inArray(
      usageLogs.apiKeyId,
      queryBuilder.select({ id: apiKeys.id }).from(apiKeys).where(ilike(apiKeys.name, pattern)),
    ),
    ilike(usageLogs.errorCode, pattern),
  );
}

/** Makes `%`, `_` and `\` match themselves: `\` is Postgres's default LIKE escape. */
function escapeLikeWildcards(text: string): string {
  return text.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}

/**
 * Who sent the request. The Usage page's API Key filter offers the Playground beside the
 * real keys, so picking both means either: listed keys OR the Playground.
 */
function callerCondition({ apiKeyId, isPlayground }: UsageFilter): SQL | undefined {
  const listedKeysCondition =
    apiKeyId === undefined ? undefined : inArray(usageLogs.apiKeyId, apiKeyId);
  if (isPlayground === undefined) return listedKeysCondition;
  const playgroundCondition = eq(usageLogs.isPlayground, isPlayground);
  if (listedKeysCondition === undefined) return playgroundCondition;
  return isPlayground
    ? or(listedKeysCondition, playgroundCondition)
    : and(listedKeysCondition, playgroundCondition);
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
