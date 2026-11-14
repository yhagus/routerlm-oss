import { and, eq, gte, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { usageLogs } from "../../db/schemas/index.js";
import type { UsageFilter, UsageStatus } from "../schemas/usage.schema.js";

const FIRST_ERROR_STATUS = 400;

/** The Usage Logs a UsageFilter selects, as a WHERE condition. */
export function whereFilter(filter: UsageFilter): SQL | undefined {
  return and(
    filter.from === undefined ? undefined : gte(usageLogs.createdAt, filter.from),
    filter.to === undefined ? undefined : lt(usageLogs.createdAt, filter.to),
    filter.modelId === undefined ? undefined : eq(usageLogs.modelId, filter.modelId),
    filter.apiKeyId === undefined ? undefined : eq(usageLogs.apiKeyId, filter.apiKeyId),
    filter.status === undefined ? undefined : statusCondition(filter.status),
    filter.isPlayground === undefined ? undefined : eq(usageLogs.isPlayground, filter.isPlayground),
  );
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
