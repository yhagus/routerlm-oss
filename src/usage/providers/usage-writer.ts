import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  apiKeys,
  attempts,
  CLIENT_PROTOCOL_KINDS,
  errorCaptures,
  usageLogs,
} from "@/db/schemas/index.js";
import {
  hasReachedSpendLimit,
  type KeySpend,
  SpendLimitFlags,
} from "@/spend-limits/providers/spend-limit-flags.js";
import type {
  ErrorCaptureRecord,
  MediaUnits,
  QueuedServingTarget,
  RequestNames,
  ServingTarget,
  UsageCaller,
  UsageCustomer,
  UsageJob,
} from "../models/usage-job.js";
import { unitCostOf, usageMeasurementsOf } from "../models/usage-measurements.js";

type NewErrorCapture = typeof errorCaptures.$inferInsert;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A ServingTarget as the writer stores it: a field the job lacked is null. */
type StoredServingTarget = { [Field in keyof ServingTarget]: ServingTarget[Field] | null };

/** What a request's records copy from its job (ADR 0024). */
interface JobSnapshot {
  requestNames: RequestNames;
  /** The Integration's name and the Customer id, both null for a key no Integration issued. */
  customerNames: { integrationName: string | null; customerId: string | null };
  /** All null when no Attempt answered. */
  servedBy: StoredServingTarget;
  /** In the order of the job's Attempts. */
  attemptTargets: StoredServingTarget[];
}

const NOT_SERVED: StoredServingTarget = {
  routeId: null,
  upstreamModelId: null,
  upstreamModelName: null,
  providerSlug: null,
  providerName: null,
  providerAccountId: null,
  providerAccountName: null,
};

/** Writes a request's Usage Log, its Attempts and its Error Captures, in the worker. */
@Injectable()
export class UsageWriter {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly spendLimitFlags: SpendLimitFlags,
  ) {}

  /**
   * Idempotent: a retried job finds its Usage Log already written and stops,
   * so its Cost is added to the API Key's spent once (ADR 0035).
   * Ids are written as the job has them, even when an operator has deleted
   * that row since: they stay what served the request (ADR 0024).
   */
  async writeUsage(job: UsageJob): Promise<void> {
    const snapshot = snapshotOf(job);
    const measurements = measurementsOf(job);
    const keySpend = await this.db.transaction(async (transaction) => {
      const written = await transaction
        .insert(usageLogs)
        .values({
          id: job.usageLogId,
          createdAt: new Date(job.receivedAt),
          ...callerColumnsOf(job.caller),
          ...snapshot.requestNames,
          ...snapshot.customerNames,
          modelId: job.modelId,
          ...servingTargetColumnsOf(snapshot.servedBy),
          kind: CLIENT_PROTOCOL_KINDS[job.clientProtocol],
          clientProtocol: job.clientProtocol,
          isStreamed: job.isStreamed,
          httpStatus: job.httpStatus,
          errorCode: job.errorCode,
          errorOrigin: job.errorOrigin ?? null,
          userAgent: job.userAgent ?? null,
          clientIp: job.clientIp ?? null,
          serviceTier: job.servedBy?.serviceTier ?? null,
          ...measurements,
          ...unitColumnsOf(job.units ?? null),
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
        return null;
      }
      // Chosen here so the Error Captures can point at their Attempts.
      const attemptIds = job.attempts.map(() => randomUUID());
      if (job.attempts.length > 0) {
        await transaction.insert(attempts).values(
          job.attempts.map((attempt, index) => ({
            id: attemptIds[index],
            usageLogId: job.usageLogId,
            startedAt: new Date(attempt.startedAt),
            ...snapshot.requestNames,
            ...snapshot.customerNames,
            ...servingTargetColumnsOf(snapshot.attemptTargets[index]),
            providerName: snapshot.attemptTargets[index].providerName,
            upstreamStatus: attempt.upstreamStatus,
            failureReason: attempt.failureReason,
            durationMs: attempt.durationMs,
            upstreamRequestId: attempt.upstreamRequestId ?? null,
          })),
        );
      }
      if (job.errorCapture) {
        await transaction
          .insert(errorCaptures)
          .values(errorCaptureRowsOf(job, job.errorCapture, attemptIds));
      }
      return job.caller.kind === "api-key"
        ? addToSpent(transaction, job.caller.apiKeyId, measurements.cost)
        : null;
    });
    // Written after the commit, so the flag never shows spend that rolled back.
    if (job.caller.kind === "api-key" && keySpend && keySpend.spendLimit !== null) {
      await this.spendLimitFlags.write(job.caller.apiKeyId, hasReachedSpendLimit(keySpend));
    }
  }
}

/**
 * Adds a request's Cost to its API Key's spent. Returns the key's spend
 * after it, or null when nothing was added: an unknown or zero Cost, or a key deleted since.
 */
async function addToSpent(
  transaction: Transaction,
  apiKeyId: string,
  cost: number | null,
): Promise<KeySpend | null> {
  if (cost === null || cost === 0) {
    return null;
  }
  const [keySpend] = await transaction
    .update(apiKeys)
    .set({ spent: sql`${apiKeys.spent} + ${cost}` })
    .where(eq(apiKeys.id, apiKeyId))
    .returning({ spent: apiKeys.spent, spendLimit: apiKeys.spendLimit });
  return keySpend ?? null;
}

/**
 * One capture per failed Attempt, linked to that Attempt (and so to its
 * Provider Account). A request that failed before any Attempt failed gets one
 * capture with no Attempt: the client's request to the gateway.
 */
function errorCaptureRowsOf(
  job: UsageJob,
  capture: ErrorCaptureRecord,
  attemptIds: string[],
): NewErrorCapture[] {
  const { request } = capture;
  // Each capture names who sent the request, so it is complete on its own (ADR 0032).
  const clientRequest = {
    usageLogId: job.usageLogId,
    requestHeaders: request.headers,
    requestBody: request.body,
    userAgent: job.userAgent ?? null,
    clientIp: job.clientIp ?? null,
  };
  if (capture.failedAttempts.length === 0) {
    return [{ ...clientRequest, id: capture.requestCaptureId }];
  }
  return capture.failedAttempts.map(({ captureId, attemptIndex, upstreamResponse }) => ({
    ...clientRequest,
    id: captureId,
    attemptId: attemptIds[attemptIndex],
    responseHeaders: upstreamResponse?.headers ?? null,
    responseBody: upstreamResponse?.body ?? null,
  }));
}

/**
 * Token counts and Cost. A media Kind counts units instead of tokens, so its
 * Cost comes from them and its missing token counts make it no less complete.
 */
function measurementsOf(job: UsageJob) {
  const measurements = usageMeasurementsOf(job.servedBy, job.usage);
  if (!job.units) {
    return measurements;
  }
  return { ...measurements, cost: unitCostOf(job.servedBy, job.units), isIncomplete: false };
}

/** The unit columns of a Usage Log: null for a unit the Kind doesn't count, and all null for chat. */
function unitColumnsOf(units: MediaUnits | null) {
  return {
    imagesOut: units?.imagesOut ?? null,
    imagesIn: units?.imagesIn ?? null,
    outputSeconds: units?.outputSeconds ?? null,
    audioSeconds: units?.audioSeconds ?? null,
    characters: units?.characters ?? null,
    unitTier: units?.tier ?? null,
  };
}

function callerColumnsOf(caller: UsageCaller) {
  switch (caller.kind) {
    case "api-key":
      return {
        apiKeyId: caller.apiKeyId,
        integrationId: caller.customer?.integrationId ?? null,
        isPlayground: false,
      };
    case "playground":
      return { userId: caller.userId, isPlayground: true };
    case "unidentified":
      return { isPlayground: false };
  }
}

/**
 * The job's request names and targets, with every field a job may lack set
 * to null. Jobs queued before Usage Logs copied names (commit 4e83ea0) lack
 * the names and an Attempt's Upstream Model id; jobs queued before Attempts
 * copied the Provider's name lack that name. Remove this tolerance, and make
 * those job fields required, once no such job can still be queued.
 */
function snapshotOf(job: UsageJob): JobSnapshot {
  const storedTargetOf = (target: QueuedServingTarget): StoredServingTarget => ({
    routeId: target.routeId,
    upstreamModelId: target.upstreamModelId ?? null,
    upstreamModelName: target.upstreamModelName ?? null,
    providerSlug: target.providerSlug ?? null,
    providerName: target.providerName ?? null,
    providerAccountId: target.providerAccountId,
    providerAccountName: target.providerAccountName ?? null,
  });
  return {
    requestNames: {
      modelName: job.modelName ?? null,
      apiKeyName: job.caller.kind === "api-key" ? (job.caller.apiKeyName ?? null) : null,
    },
    customerNames: {
      integrationName: customerOf(job.caller)?.integrationName ?? null,
      customerId: customerOf(job.caller)?.customerId ?? null,
    },
    servedBy: job.servedBy ? storedTargetOf(job.servedBy) : NOT_SERVED,
    attemptTargets: job.attempts.map(storedTargetOf),
  };
}

/** The target columns a Usage Log and its Attempts share; only an Attempt also copies the Provider's name. */
function servingTargetColumnsOf(target: StoredServingTarget) {
  return {
    routeId: target.routeId,
    upstreamModelId: target.upstreamModelId,
    upstreamModelName: target.upstreamModelName,
    providerSlug: target.providerSlug,
    providerAccountId: target.providerAccountId,
    providerAccountName: target.providerAccountName,
  };
}

function customerOf(caller: UsageCaller): UsageCustomer | undefined {
  return caller.kind === "api-key" ? caller.customer : undefined;
}
