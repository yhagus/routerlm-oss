import { eq } from "drizzle-orm";
import type { Database } from "../../db/schemas/relations.js";
import {
  type RecordedAttemptFailure,
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  providers,
  usageLogs,
} from "../../db/schemas/index.js";
import type { ErrorCaptureSummary, FailedHop } from "./error-capture.js";

/** The columns a summary is made of: no headers or bodies, so the list stays light. */
const summaryColumns = {
  id: errorCaptures.id,
  createdAt: errorCaptures.createdAt,
  usageLogId: errorCaptures.usageLogId,
  modelName: models.name,
  apiKeyName: apiKeys.name,
  isPlayground: usageLogs.isPlayground,
  clientProtocol: usageLogs.clientProtocol,
  httpStatus: usageLogs.httpStatus,
  errorCode: usageLogs.errorCode,
  attemptId: attempts.id,
  providerAccountId: attempts.providerAccountId,
  providerAccountName: providerAccounts.name,
  providerName: providers.name,
  upstreamStatus: attempts.upstreamStatus,
  failureReason: attempts.failureReason,
};

/**
 * Each capture with its Usage Log and, for a failed Attempt, the Provider
 * Account it went to. Map the rows with `summaryOf`.
 */
export function selectSummaryRows(db: Database) {
  return db
    .select(summaryColumns)
    .from(errorCaptures)
    .innerJoin(usageLogs, eq(usageLogs.id, errorCaptures.usageLogId))
    .leftJoin(models, eq(models.id, usageLogs.modelId))
    .leftJoin(apiKeys, eq(apiKeys.id, usageLogs.apiKeyId))
    .leftJoin(attempts, eq(attempts.id, errorCaptures.attemptId))
    .leftJoin(providerAccounts, eq(providerAccounts.id, attempts.providerAccountId))
    .leftJoin(providers, eq(providers.id, providerAccounts.providerId));
}

/** A row of `summaryColumns`: the Attempt's columns are null for a client-to-gateway capture. */
interface SummaryRow extends Omit<ErrorCaptureSummary, "failedHop"> {
  attemptId: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerName: string | null;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
}

export function summaryOf(row: SummaryRow): ErrorCaptureSummary {
  return {
    id: row.id,
    createdAt: row.createdAt,
    usageLogId: row.usageLogId,
    modelName: row.modelName,
    apiKeyName: row.apiKeyName,
    isPlayground: row.isPlayground,
    clientProtocol: row.clientProtocol,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    failedHop: failedHopOf(row),
  };
}

function failedHopOf(row: SummaryRow): FailedHop {
  if (row.attemptId === null) {
    return { kind: "client-to-gateway" };
  }
  return {
    kind: "gateway-to-provider-account",
    attemptId: row.attemptId,
    providerAccountId: row.providerAccountId,
    providerAccountName: row.providerAccountName,
    providerName: row.providerName,
    upstreamStatus: row.upstreamStatus,
    failureReason: row.failureReason,
  };
}
