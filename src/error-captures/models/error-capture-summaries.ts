import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  type RecordedAttemptFailure,
  attempts,
  errorCaptures,
  usageLogs,
} from "@/db/schemas/index.js";
import type { ErrorCaptureSummary, FailedHop } from "./error-capture.js";

const summaryColumns = {
  id: errorCaptures.id,
  createdAt: errorCaptures.createdAt,
  usageLogId: errorCaptures.usageLogId,
  modelName: usageLogs.modelName,
  apiKeyName: usageLogs.apiKeyName,
  integrationId: usageLogs.integrationId,
  integrationName: usageLogs.integrationName,
  customerId: usageLogs.customerId,
  isPlayground: usageLogs.isPlayground,
  clientProtocol: usageLogs.clientProtocol,
  httpStatus: usageLogs.httpStatus,
  errorCode: usageLogs.errorCode,
  userAgent: errorCaptures.userAgent,
  clientIp: errorCaptures.clientIp,
  attemptId: attempts.id,
  providerAccountId: attempts.providerAccountId,
  providerAccountName: attempts.providerAccountName,
  providerName: attempts.providerName,
  upstreamStatus: attempts.upstreamStatus,
  failureReason: attempts.failureReason,
  upstreamRequestId: attempts.upstreamRequestId,
};

export function selectSummaryRows(db: Database) {
  return db
    .select(summaryColumns)
    .from(errorCaptures)
    .innerJoin(usageLogs, eq(usageLogs.id, errorCaptures.usageLogId))
    .leftJoin(attempts, eq(attempts.id, errorCaptures.attemptId));
}

interface SummaryRow extends Omit<ErrorCaptureSummary, "failedHop"> {
  attemptId: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerName: string | null;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
  upstreamRequestId: string | null;
}

export function summaryOf(row: SummaryRow): ErrorCaptureSummary {
  return {
    id: row.id,
    createdAt: row.createdAt,
    usageLogId: row.usageLogId,
    modelName: row.modelName,
    apiKeyName: row.apiKeyName,
    integrationId: row.integrationId,
    integrationName: row.integrationName,
    customerId: row.customerId,
    isPlayground: row.isPlayground,
    clientProtocol: row.clientProtocol,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    userAgent: row.userAgent,
    clientIp: row.clientIp,
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
    upstreamRequestId: row.upstreamRequestId,
  };
}
