import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db/relations.js";
import {
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  routes,
  usageLogs,
  users,
} from "../db/schema.js";
import type { ErrorCaptureRecord, UsageCaller, UsageJob } from "./models/usage-job.js";
import { usageMeasurementsOf } from "./models/usage-measurements.js";

type TableWithId = PgTable & { id: AnyPgColumn };

type NewErrorCapture = typeof errorCaptures.$inferInsert;

/** Writes a request's Usage Log, its Attempts and its Error Captures, in the worker. */
@Injectable()
export class UsageWriter {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Idempotent: a retried job finds its Usage Log already written and stops. */
  async writeUsage(job: UsageJob): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const written = await transaction
        .insert(usageLogs)
        .values({
          id: job.usageLogId,
          createdAt: new Date(job.receivedAt),
          ...callerColumnsOf(job.caller),
          modelId: existingId(models, job.modelId),
          routeId: existingId(routes, job.servedBy?.routeId ?? null),
          providerAccountId: existingId(providerAccounts, job.servedBy?.providerAccountId ?? null),
          clientProtocol: job.clientProtocol,
          isStreamed: job.isStreamed,
          httpStatus: job.httpStatus,
          errorCode: job.errorCode,
          ...usageMeasurementsOf(job.servedBy, job.usage),
          requestBytes: job.requestBytes,
          responseBytes: job.responseBytes,
          timeToFirstTokenMs: job.timeToFirstTokenMs,
          durationMs: job.durationMs,
          attemptCount: job.attempts.length,
          isCancelled: job.isCancelled,
        })
        .onConflictDoNothing({ target: usageLogs.id })
        .returning({ id: usageLogs.id });
      if (written.length === 0) {
        return;
      }
      // Chosen here so the Error Captures can point at their Attempts.
      const attemptIds = job.attempts.map(() => randomUUID());
      if (job.attempts.length > 0) {
        await transaction.insert(attempts).values(
          job.attempts.map((attempt, index) => ({
            id: attemptIds[index],
            usageLogId: job.usageLogId,
            startedAt: new Date(attempt.startedAt),
            routeId: existingId(routes, attempt.routeId),
            providerAccountId: existingId(providerAccounts, attempt.providerAccountId),
            upstreamStatus: attempt.upstreamStatus,
            failureReason: attempt.failureReason,
            durationMs: attempt.durationMs,
          })),
        );
      }
      if (job.errorCapture) {
        await transaction
          .insert(errorCaptures)
          .values(errorCaptureRowsOf(job.usageLogId, job.errorCapture, attemptIds));
      }
    });
  }
}

/**
 * One capture per failed Attempt, linked to that Attempt (and so to its
 * Provider Account). A request that failed before any Attempt failed gets one
 * capture with no Attempt: the client's request to the gateway.
 */
function errorCaptureRowsOf(
  usageLogId: string,
  capture: ErrorCaptureRecord,
  attemptIds: string[],
): NewErrorCapture[] {
  const { request } = capture;
  if (capture.failedAttempts.length === 0) {
    return [{ usageLogId, requestHeaders: request.headers, requestBody: request.body }];
  }
  return capture.failedAttempts.map(({ attemptIndex, upstreamResponse }) => ({
    usageLogId,
    attemptId: attemptIds[attemptIndex],
    requestHeaders: request.headers,
    requestBody: request.body,
    responseHeaders: upstreamResponse?.headers ?? null,
    responseBody: upstreamResponse?.body ?? null,
  }));
}

function callerColumnsOf(caller: UsageCaller) {
  switch (caller.kind) {
    case "api-key":
      return { apiKeyId: existingId(apiKeys, caller.apiKeyId), isPlayground: false };
    case "playground":
      return { userId: existingId(users, caller.userId), isPlayground: true };
    case "unidentified":
      return { isPlayground: false };
  }
}

/**
 * The id, or null once its row is gone. The job was made from the backend's
 * in-memory snapshot, so an operator may have deleted that API Key, Model,
 * Route or Provider Account before the worker gets here; the record is kept
 * with the link cleared, as ON DELETE SET NULL would have done.
 */
function existingId(table: TableWithId, id: string | null): SQL | null {
  if (id === null) {
    return null;
  }
  return sql`(select ${table.id} from ${table} where ${table.id} = ${id})`;
}
