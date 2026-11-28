import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/db/schemas/relations';
import { apiKeys, attempts, CLIENT_PROTOCOL_KINDS, errorCaptures, usageLogs } from '@/db/schemas';
import { SpendLimitFlags } from '@/spend-limits/providers/spend-limit-flags';
import type {
  ErrorCaptureRecord,
  MediaUnits,
  RequestNames,
  ServingTarget,
  UsageCaller,
  UsageJob,
} from '@/usage/models/usage-job';
import { unitCostOf, usageMeasurementsOf } from '@/usage/models/usage-measurements';

type NewErrorCapture = typeof errorCaptures.$inferInsert;
type StoredServingTarget = { [Field in keyof ServingTarget]: ServingTarget[Field] | null };

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
    const requestNames = requestNamesOf(job);
    const customerNames = customerNamesOf(job.caller);
    const measurements = measurementsOf(job);
    const kind = CLIENT_PROTOCOL_KINDS[job.clientProtocol];
    const hasSpentAgainstLimit = await this.db.transaction(async (transaction) => {
      const written = await transaction
        .insert(usageLogs)
        .values({
          id: job.usageLogId,
          createdAt: new Date(job.receivedAt),
          ...callerColumnsOf(job.caller),
          ...requestNames,
          ...customerNames,
          modelId: job.modelId,
          ...servingTargetColumnsOf(job.servedBy ?? NOT_SERVED),
          requestedModelName: job.requestedModelName,
          upstreamProtocol: job.servedBy?.upstreamProtocol ?? null,
          kind,
          clientProtocol: job.clientProtocol,
          isStreamed: job.isStreamed,
          httpStatus: job.httpStatus,
          errorCode: job.errorCode,
          errorOrigin: job.errorOrigin,
          userAgent: job.userAgent,
          clientIp: job.clientIp,
          serviceTier: job.servedBy?.serviceTier ?? null,
          pricingWindowName: job.servedBy?.pricingWindowName ?? null,
          ...measurements,
          ...unitColumnsOf(job.units),
          imageCount: kind === 'image' ? (job.units?.imagesOut ?? null) : null,
          requestBytes: job.requestBytes,
          responseBytes: job.responseBytes,
          timeToFirstTokenMs: job.timeToFirstTokenMs,
          ...responseColumnsOf(job),
          durationMs: job.durationMs,
          slotWaitMs: job.slotWaitMs,
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
            ...requestNames,
            ...customerNames,
            ...servingTargetColumnsOf(attempt),
            providerName: attempt.providerName,
            upstreamStatus: attempt.upstreamStatus,
            failureReason: attempt.failureReason,
            durationMs: attempt.durationMs,
            upstreamRequestId: attempt.upstreamRequestId,
          })),
        );
      }
      if (job.errorCapture) {
        await transaction
          .insert(errorCaptures)
          .values(errorCaptureRowsOf(job, job.errorCapture, attemptIds));
      }
      return job.caller.kind === 'api-key'
        ? addToSpent(transaction, job.caller.apiKeyId, measurements.cost)
        : false;
    });
    if (job.caller.kind === 'api-key' && hasSpentAgainstLimit) {
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
    userAgent: job.userAgent,
    clientIp: job.clientIp,
  };
  if (capture.failedAttempts.length === 0) {
    return [
      {
        ...clientRequest,
        id: capture.requestCaptureId,
        upstreamProtocol: job.servedBy?.upstreamProtocol ?? null,
      },
    ];
  }
  return capture.failedAttempts.map(({ captureId, attemptIndex, upstreamResponse }) => ({
    ...clientRequest,
    id: captureId,
    attemptId: attemptIds[attemptIndex],
    upstreamProtocol: job.attempts.at(attemptIndex)?.upstreamProtocol ?? null,
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

function responseColumnsOf(job: UsageJob) {
  return {
    isReasoningStreamed: job.isReasoningStreamed,
    finishReason: job.finishReason,
    maxOutputTokens: job.sentParameters?.maxOutputTokens ?? null,
    reasoningEffort: job.sentParameters?.reasoningEffort ?? null,
    thinkingBudgetTokens: job.sentParameters?.thinkingBudgetTokens ?? null,
    toolCount: job.toolCount,
    toolCallCount: job.toolCallCount,
  };
}

function callerColumnsOf(caller: UsageCaller) {
  switch (caller.kind) {
    case 'api-key':
      return {
        apiKeyId: caller.apiKeyId,
        integrationId: caller.customer?.integrationId ?? null,
        isPlayground: false,
      };
    case 'playground':
      return { userId: caller.userId, userEmail: caller.userEmail, isPlayground: true };
    case 'unidentified':
      return { isPlayground: false };
  }
}

function requestNamesOf(job: UsageJob): RequestNames {
  return {
    modelName: job.modelName,
    apiKeyName: job.caller.kind === 'api-key' ? job.caller.apiKeyName : null,
  };
}

function customerNamesOf(caller: UsageCaller) {
  const customer = caller.kind === 'api-key' ? caller.customer : null;
  return {
    integrationName: customer?.integrationName ?? null,
    customerId: customer?.customerId ?? null,
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
