import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import { attempts, errorCaptures, usageLogs } from "@/db/schemas/index.js";
import type { ErrorCaptureRecord, UsageCaller, UsageJob } from "../models/usage-job.js";
import { usageMeasurementsOf } from "../models/usage-measurements.js";

type NewErrorCapture = typeof errorCaptures.$inferInsert;

/** Writes a request's Usage Log, its Attempts and its Error Captures, in the worker. */
@Injectable()
export class UsageWriter {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /**
   * Idempotent: a retried job finds its Usage Log already written and stops.
   * Ids are written as the job has them, even when an operator has deleted
   * that row since: they stay what served the request (ADR 0024). Names
   * missing from a job queued before they were copied are written as null.
   */
  async writeUsage(job: UsageJob): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const written = await transaction
        .insert(usageLogs)
        .values({
          id: job.usageLogId,
          createdAt: new Date(job.receivedAt),
          ...callerColumnsOf(job.caller),
          modelId: job.modelId,
          modelName: job.modelName ?? null,
          routeId: job.servedBy?.routeId ?? null,
          upstreamModelId: job.servedBy?.upstreamModelId ?? null,
          upstreamModelName: job.servedBy?.upstreamModelName ?? null,
          providerSlug: job.servedBy?.providerSlug ?? null,
          providerAccountId: job.servedBy?.providerAccountId ?? null,
          providerAccountName: job.servedBy?.providerAccountName ?? null,
          clientProtocol: job.clientProtocol,
          isStreamed: job.isStreamed,
          httpStatus: job.httpStatus,
          errorCode: job.errorCode,
          serviceTier: job.servedBy?.serviceTier ?? null,
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
            modelName: job.modelName ?? null,
            apiKeyName: apiKeyNameOf(job.caller),
            routeId: attempt.routeId,
            upstreamModelId: attempt.upstreamModelId ?? null,
            upstreamModelName: attempt.upstreamModelName ?? null,
            providerSlug: attempt.providerSlug ?? null,
            providerAccountId: attempt.providerAccountId,
            providerAccountName: attempt.providerAccountName ?? null,
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
      return { apiKeyId: caller.apiKeyId, apiKeyName: apiKeyNameOf(caller), isPlayground: false };
    case "playground":
      return { userId: caller.userId, isPlayground: true };
    case "unidentified":
      return { isPlayground: false };
  }
}

function apiKeyNameOf(caller: UsageCaller): string | null {
  return caller.kind === "api-key" ? (caller.apiKeyName ?? null) : null;
}
