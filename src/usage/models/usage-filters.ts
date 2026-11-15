import { and, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { usageLogs } from "@/db/schemas/index.js";
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
  );
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
