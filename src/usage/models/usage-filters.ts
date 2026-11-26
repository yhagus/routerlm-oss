import { and, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { type ErrorOrigin, usageLogs } from "@/db/schemas";
import type { UsageFilter, UsageStatus } from "@/usage/schemas/usage.schema";

const FIRST_ERROR_STATUS = 400;

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

export function namesOrErrorCodeContain(text: string): SQL | undefined {
  const pattern = containing(text);
  return or(
    ilike(usageLogs.modelName, pattern),
    ilike(usageLogs.apiKeyName, pattern),
    ilike(usageLogs.errorCode, pattern),
  );
}

export function containing(text: string): string {
  return `%${escapeLikeWildcards(text)}%`;
}

export function startingWith(text: string): string {
  return `${escapeLikeWildcards(text)}%`;
}

function escapeLikeWildcards(text: string): string {
  return text.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}

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

export function customerCondition({
  integrationId,
  customerId,
}: Pick<UsageFilter, "integrationId" | "customerId">): SQL | undefined {
  return and(
    integrationId === undefined ? undefined : inArray(usageLogs.integrationId, integrationId),
    customerId === undefined ? undefined : eq(usageLogs.customerId, customerId),
  );
}

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
