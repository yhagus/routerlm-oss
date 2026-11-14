import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, desc, eq } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import {
  type RecordedAttemptFailure,
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  providers,
  usageLogs,
} from "../db/schema.js";
import type {
  ErrorCaptureDetail,
  ErrorCapturePage,
  ErrorCaptureSummary,
  FailedHop,
} from "./error-capture.js";
import type { ErrorCapturePageQuery } from "./error-captures.schemas.js";

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

/** Reads Error Captures for the dashboard. */
@Injectable()
export class ErrorCapturesService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Newest first. */
  async listErrorCaptures(query: ErrorCapturePageQuery): Promise<ErrorCapturePage> {
    const where = query.usageLogId ? eq(errorCaptures.usageLogId, query.usageLogId) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.selectSummaries()
        .where(where)
        .orderBy(desc(errorCaptures.createdAt), desc(errorCaptures.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(errorCaptures).where(where),
    ]);
    return { items: rows.map(summaryOf), total, page: query.page, pageSize: query.pageSize };
  }

  async showErrorCapture(id: string): Promise<ErrorCaptureDetail> {
    const [[summary], [content]] = await Promise.all([
      this.selectSummaries().where(eq(errorCaptures.id, id)),
      this.db
        .select({
          requestHeaders: errorCaptures.requestHeaders,
          requestBody: errorCaptures.requestBody,
          responseHeaders: errorCaptures.responseHeaders,
          responseBody: errorCaptures.responseBody,
        })
        .from(errorCaptures)
        .where(eq(errorCaptures.id, id)),
    ]);
    if (!summary || !content) {
      throw new NotFoundException("Error Capture not found");
    }
    return { ...summaryOf(summary), ...content };
  }

  /** Each capture with its Usage Log and, for a failed Attempt, the Provider Account it went to. */
  private selectSummaries() {
    return this.db
      .select(summaryColumns)
      .from(errorCaptures)
      .innerJoin(usageLogs, eq(usageLogs.id, errorCaptures.usageLogId))
      .leftJoin(models, eq(models.id, usageLogs.modelId))
      .leftJoin(apiKeys, eq(apiKeys.id, usageLogs.apiKeyId))
      .leftJoin(attempts, eq(attempts.id, errorCaptures.attemptId))
      .leftJoin(providerAccounts, eq(providerAccounts.id, attempts.providerAccountId))
      .leftJoin(providers, eq(providers.id, providerAccounts.providerId));
  }
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

function summaryOf(row: SummaryRow): ErrorCaptureSummary {
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
