import { randomUUID } from "node:crypto";
import type { ClientProtocol, GatewayErrorCode } from "../db/schema.js";
import type { AttemptRecord, ServedBy, UsageCaller, UsageJob } from "../usage/usage-job.js";
import type { AttemptFailedError } from "./attempt-failure.js";
import type { GatewayError } from "./gateway-error.js";
import type { TokenUsage } from "./internal-format.js";
import type { AttemptTarget } from "./route-selection.js";

/**
 * The upstream status recorded for an Attempt that answered. UpstreamClient
 * only tells that the status was 2xx, and the Providers we speak to answer 200.
 */
const ANSWERED_UPSTREAM_STATUS = 200;

interface OpenAttempt {
  target: AttemptTarget;
  startedAt: Date;
  startedMs: number;
  hasAnswered: boolean;
}

/**
 * Measures one inference request as it goes, for its Usage Log and Attempts
 * (spec "Records"). It only ever sees counts, sizes, ids and times, never
 * content (ADR 0004). `finish` turns it into the usage job.
 */
export class UsageMeter {
  private readonly usageLogId = randomUUID();
  private readonly receivedAt = new Date();
  private readonly receivedMs = performance.now();
  private isStreamed = false;
  private modelId: string | null = null;
  private errorCode: GatewayErrorCode | null = null;
  private readonly attempts: AttemptRecord[] = [];
  private openAttempt: OpenAttempt | null = null;
  private servedBy: ServedBy | null = null;
  private usage: TokenUsage | null = null;
  private timeToFirstTokenMs: number | null = null;
  private responseBytes = 0;

  constructor(
    private readonly caller: UsageCaller,
    private readonly clientProtocol: ClientProtocol,
    private readonly requestBytes: number,
  ) {}

  requestParsed(isStreamed: boolean): void {
    this.isStreamed = isStreamed;
  }

  modelResolved(modelId: string): void {
    this.modelId = modelId;
  }

  attemptStarted(target: AttemptTarget): void {
    this.openAttempt = {
      target,
      startedAt: new Date(),
      startedMs: performance.now(),
      hasAnswered: false,
    };
  }

  /** The upstream answered: the whole response, or a stream's first event. */
  attemptAnswered(): void {
    if (!this.openAttempt) {
      return;
    }
    this.openAttempt.hasAnswered = true;
    const { route, providerAccount } = this.openAttempt.target;
    const { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice } = route.upstreamModel;
    this.servedBy = {
      routeId: route.id,
      providerAccountId: providerAccount.id,
      // Taken now, so a later price edit doesn't change this request's Cost.
      prices: { inputPrice, outputPrice, cacheReadPrice, cacheWritePrice },
    };
    if (this.isStreamed) {
      this.timeToFirstTokenMs = elapsedSince(this.receivedMs);
    }
  }

  usageReported(usage: TokenUsage): void {
    this.usage = usage;
  }

  attemptFailed(failure: AttemptFailedError): void {
    const hasAnswered = this.openAttempt?.hasAnswered ?? false;
    this.closeAttempt(
      failure.reason,
      failure.upstreamStatus ?? (hasAnswered ? ANSWERED_UPSTREAM_STATUS : null),
    );
  }

  attemptSucceeded(): void {
    this.closeAttempt(null, ANSWERED_UPSTREAM_STATUS);
  }

  /** The error the client got, as a status or as a stream's error event. */
  failedWith(errorCode: GatewayErrorCode): void {
    this.errorCode = errorCode;
  }

  /** Finishes a request answered with `error`, whose body is the client Protocol's `envelope`. */
  finishWithError(error: GatewayError, envelope: unknown): UsageJob {
    this.failedWith(error.code);
    this.responseWritten(JSON.stringify(envelope));
    return this.finish(error.status, false);
  }

  responseWritten(text: string): void {
    this.responseBytes += Buffer.byteLength(text);
  }

  finish(httpStatus: number, isCancelled: boolean): UsageJob {
    if (this.openAttempt) {
      // Only a client leaving ends a request while an Attempt is still running.
      const hasAnswered = this.openAttempt.hasAnswered;
      this.closeAttempt(
        isCancelled ? "cancelled" : null,
        hasAnswered ? ANSWERED_UPSTREAM_STATUS : null,
      );
    }
    return {
      usageLogId: this.usageLogId,
      receivedAt: this.receivedAt.toISOString(),
      caller: this.caller,
      modelId: this.modelId,
      clientProtocol: this.clientProtocol,
      isStreamed: this.isStreamed,
      httpStatus,
      errorCode: this.errorCode,
      servedBy: this.servedBy,
      usage: this.usage,
      requestBytes: this.requestBytes,
      responseBytes: this.responseBytes,
      timeToFirstTokenMs: this.timeToFirstTokenMs,
      durationMs: elapsedSince(this.receivedMs),
      isCancelled,
      attempts: this.attempts,
    };
  }

  private closeAttempt(
    failureReason: AttemptRecord["failureReason"],
    upstreamStatus: number | null,
  ): void {
    if (!this.openAttempt) {
      return;
    }
    const { target, startedAt, startedMs } = this.openAttempt;
    this.attempts.push({
      startedAt: startedAt.toISOString(),
      routeId: target.route.id,
      providerAccountId: target.providerAccount.id,
      upstreamStatus,
      failureReason,
      durationMs: elapsedSince(startedMs),
    });
    this.openAttempt = null;
  }
}

function elapsedSince(startMs: number): number {
  return Math.round(performance.now() - startMs);
}
