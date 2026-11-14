import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../db/relations.js";
import {
  apiKeys,
  attempts,
  models,
  providerAccounts,
  routes,
  usageLogs,
  users,
} from "../db/schema.js";
import type { UsageCaller, UsageJob } from "./usage-job.js";
import { usageMeasurementsOf } from "./usage-measurements.js";

type TableWithId = PgTable & { id: AnyPgColumn };

/** Writes a request's Usage Log and its Attempts, in the worker. */
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
      if (written.length === 0 || job.attempts.length === 0) {
        return;
      }
      await transaction.insert(attempts).values(
        job.attempts.map((attempt) => ({
          usageLogId: job.usageLogId,
          startedAt: new Date(attempt.startedAt),
          routeId: existingId(routes, attempt.routeId),
          providerAccountId: existingId(providerAccounts, attempt.providerAccountId),
          upstreamStatus: attempt.upstreamStatus,
          failureReason: attempt.failureReason,
          durationMs: attempt.durationMs,
        })),
      );
    });
  }
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
