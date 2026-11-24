import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db/schemas/relations.js";
import {
  apiKeys,
  attempts,
  CLIENT_PROTOCOL_KINDS,
  errorCaptures,
  usageLogs,
} from "@/db/schemas/index.js";
import { SpendLimitFlags } from "@/spend-limits/providers/spend-limit-flags.js";
import type {
  ErrorCaptureRecord,
  MediaUnits,
  QueuedServingTarget,
  RequestNames,
  ServingTarget,
  UsageCaller,
  UsageCustomer,
  UsageJob,
} from "@/usage/models/usage-job.js";
import { unitCostOf, usageMeasurementsOf } from "@/usage/models/usage-measurements.js";

type NewErrorCapture = typeof errorCaptures.$inferInsert;
type StoredServingTarget = { [Field in keyof ServingTarget]: ServingTarget[Field] | null };

interface JobSnapshot {
  requestNames: RequestNames;
  customerNames: { integrationName: string | null; customerId: string | null };
  servedBy: StoredServingTarget;
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

@Injectable()
export class UsageWriter {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly spendLimitFlags: SpendLimitFlags,
  ) {}

  async writeUsage(job: UsageJob): Promise<void> {
    const snapshot = snapshotOf(job);
    const measurements = measurementsOf(job);
    const hasSpentAgainstLimit = await this.db.transaction(async (transaction) => {
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
          pricingWindowName: job.servedBy?.pricingWindowName ?? null,
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
        return false;
      }
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
        : false;
    });
    if (job.caller.kind === "api-key" && hasSpentAgainstLimit) {
      await this.spendLimitFlags.recompute(job.caller.apiKeyId);
    }
  }
}

async function addToSpent(
  transaction: Transaction,
  apiKeyId: string,
  cost: number | null,
): Promise<boolean> {
  if (cost === null || cost === 0) {
    return false;
  }
  const [keySpend] = await transaction
    .update(apiKeys)
    .set({ spent: sql`${apiKeys.spent} + ${cost}` })
    .where(eq(apiKeys.id, apiKeyId))
    .returning({ spendLimit: apiKeys.spendLimit });
  return keySpend !== undefined && keySpend.spendLimit !== null;
}

function errorCaptureRowsOf(
  job: UsageJob,
  capture: ErrorCaptureRecord,
  attemptIds: string[],
): NewErrorCapture[] {
  const { request } = capture;
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

function measurementsOf(job: UsageJob) {
  const measurements = usageMeasurementsOf(job.servedBy, job.usage);
  if (!job.units) {
    return measurements;
  }
  return { ...measurements, cost: unitCostOf(job.servedBy, job.units), isIncomplete: false };
}

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
