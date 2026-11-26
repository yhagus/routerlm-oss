import { randomUUID } from "node:crypto";
import type {
  ClientProtocol,
  ErrorOrigin,
  GatewayErrorCode,
  UpstreamProtocol,
} from "@/db/schemas/index.js";
import {
  capturedBody,
  capturedHeaders,
  type RawHeaders,
} from "@/error-captures/models/captured-content.js";
import type { RequestSender } from "@/libs/models/client-connection.js";
import type {
  AttemptRecord,
  CapturedMessage,
  ErrorCaptureRecord,
  MediaUnits,
  ServedBy,
  ServingTarget,
  UsageCaller,
  UsageJob,
} from "@/usage/models/usage-job.js";
import type { AttemptFailedError, UpstreamFailureResponse } from "./attempt-failure.js";
import type { GatewayError } from "./gateway-error.js";
import type { TokenUsage } from "./internal-format.js";
import type { AttemptTarget } from "./route-selection.js";
import { pricesForRequest } from "./request-prices.js";
import { type SentServiceTier, serviceTierOfWireValue } from "./service-tier.js";

const ANSWERED_UPSTREAM_STATUS = 200;
const FIRST_ERROR_STATUS = 400;

interface OpenAttempt {
  target: AttemptTarget;
  upstreamProtocol: UpstreamProtocol;
  sentServiceTier: SentServiceTier | null;
  startedAt: Date;
  startedMs: number;
  hasAnswered: boolean;
  upstreamRequestId: string | null;
}

interface ClientRequest {
  headers: RawHeaders;
  body: unknown;
}

interface FailedAttempt {
  captureId: string;
  attemptIndex: number;
  upstreamResponse: UpstreamFailureResponse | null;
}

export class UsageMeter {
  private readonly usageLogId = randomUUID();
  private readonly receivedAt = new Date();
  private readonly receivedMs = performance.now();
  private isStreamed = false;
  private modelId: string | null = null;
  private modelName: string | null = null;
  private errorCode: GatewayErrorCode | null = null;
  private errorOrigin: ErrorOrigin | null = null;
  private readonly attempts: AttemptRecord[] = [];
  private openAttempt: OpenAttempt | null = null;
  private servedBy: ServedBy | null = null;
  private usage: TokenUsage | null = null;
  private units: MediaUnits | null = null;
  private timeToFirstTokenMs: number | null = null;
  private responseBytes = 0;
  private clientRequest: ClientRequest | null = null;
  private readonly failedAttempts: FailedAttempt[] = [];
  private readonly credentialSecrets: string[] = [];

  constructor(
    private readonly caller: UsageCaller,
    private readonly clientProtocol: ClientProtocol,
    private readonly requestBytes: number,
    private readonly sender: RequestSender,
  ) {}

  requestReceived(headers: RawHeaders, body: unknown): void {
    this.clientRequest = { headers, body };
  }

  requestParsed(isStreamed: boolean): void {
    this.isStreamed = isStreamed;
  }

  modelResolved(modelId: string, modelName: string): void {
    this.modelId = modelId;
    this.modelName = modelName;
  }

  attemptStarted(
    target: AttemptTarget,
    upstreamProtocol: UpstreamProtocol,
    sentServiceTier: SentServiceTier | null,
  ): void {
    this.openAttempt = {
      target,
      upstreamProtocol,
      sentServiceTier,
      startedAt: new Date(),
      startedMs: performance.now(),
      hasAnswered: false,
      upstreamRequestId: null,
    };
  }

  credentialUsed(secret: string): void {
    this.credentialSecrets.push(secret);
  }

  attemptSkippedAsExhausted(target: AttemptTarget): void {
    this.attempts.push({
      startedAt: new Date().toISOString(),
      ...servingTargetOf(target),
      upstreamProtocol: null,
      upstreamStatus: null,
      failureReason: "exhausted",
      durationMs: 0,
      upstreamRequestId: null,
    });
  }

  attemptAnswered(upstreamRequestId: string | null): void {
    if (!this.openAttempt) {
      return;
    }
    this.openAttempt.hasAnswered = true;
    this.openAttempt.upstreamRequestId = upstreamRequestId;
    const { target, upstreamProtocol } = this.openAttempt;
    const serviceTier = this.openAttempt.sentServiceTier?.tier ?? null;
    this.servedBy = {
      ...servingTargetOf(target),
      upstreamProtocol,
      serviceTier,
      ...pricesForRequest(target.upstreamModel, serviceTier, this.receivedAt),
      unitPrices: target.upstreamModel.unitPrices,
    };
    if (this.isStreamed) {
      this.timeToFirstTokenMs = elapsedSince(this.receivedMs);
    }
  }

  usageReported(usage: TokenUsage, servedTierValue: string | undefined): void {
    this.usage = usage;
    if (servedTierValue === undefined || !this.servedBy || !this.openAttempt) {
      return;
    }
    const { upstreamModel } = this.openAttempt.target;
    const serviceTier = serviceTierOfWireValue(
      servedTierValue,
      upstreamModel.provider.serviceTierValues,
    );
    this.servedBy = {
      ...this.servedBy,
      serviceTier,
      ...pricesForRequest(upstreamModel, serviceTier, this.receivedAt),
    };
  }

  unitsCounted(units: MediaUnits): void {
    this.units = units;
  }

  attemptFailed(failure: AttemptFailedError): void {
    if (!this.openAttempt) {
      return;
    }
    this.failedAttempts.push({
      captureId: randomUUID(),
      attemptIndex: this.attempts.length,
      upstreamResponse: failure.upstreamResponse,
    });
    this.openAttempt.upstreamRequestId =
      failure.upstreamRequestId ?? this.openAttempt.upstreamRequestId;
    const hasAnswered = this.openAttempt.hasAnswered;
    this.closeAttempt(
      failure.reason,
      failure.upstreamStatus ?? (hasAnswered ? ANSWERED_UPSTREAM_STATUS : null),
    );
  }

  attemptInterrupted(): void {
    this.closeAttempt("stream_interrupted", ANSWERED_UPSTREAM_STATUS);
  }

  attemptSucceeded(): void {
    this.closeAttempt(null, ANSWERED_UPSTREAM_STATUS);
  }

  failedWith(error: GatewayError): void {
    this.errorCode = error.code;
    this.errorOrigin = error.origin;
  }

  failedInGateway(): void {
    this.errorOrigin = "gateway";
  }

  finishWithError(error: GatewayError, envelope: unknown): UsageJob {
    this.failedWith(error);
    this.responseWritten(Buffer.byteLength(JSON.stringify(envelope)));
    return this.finish(error.status, false);
  }

  responseWritten(byteLength: number): void {
    this.responseBytes += byteLength;
  }

  finish(httpStatus: number, isCancelled: boolean): UsageJob {
    if (this.openAttempt) {
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
      modelName: this.modelName,
      clientProtocol: this.clientProtocol,
      isStreamed: this.isStreamed,
      httpStatus,
      errorCode: this.errorCode,
      errorOrigin: isCancelled ? null : this.errorOrigin,
      userAgent: this.sender.userAgent,
      clientIp: this.sender.clientIp,
      servedBy: this.servedBy,
      usage: this.usage,
      units: this.units,
      requestBytes: this.requestBytes,
      responseBytes: this.responseBytes,
      timeToFirstTokenMs: this.timeToFirstTokenMs,
      durationMs: elapsedSince(this.receivedMs),
      isCancelled,
      attempts: this.attempts,
      errorCapture: this.errorCaptureOf(httpStatus, isCancelled),
    };
  }

  private errorCaptureOf(httpStatus: number, isCancelled: boolean): ErrorCaptureRecord | null {
    const hasFailed = httpStatus >= FIRST_ERROR_STATUS || this.errorCode !== null;
    const hasFailedAttempts = this.failedAttempts.length > 0;
    if (!this.clientRequest) {
      return null;
    }
    if (!hasFailedAttempts && (!hasFailed || isCancelled)) {
      return null;
    }
    return {
      requestCaptureId: randomUUID(),
      request: this.captured({
        headers: this.clientRequest.headers,
        body: JSON.stringify(this.clientRequest.body) ?? "",
      }),
      failedAttempts: this.failedAttempts.map(({ captureId, attemptIndex, upstreamResponse }) => ({
        captureId,
        attemptIndex,
        upstreamResponse: upstreamResponse && this.captured(upstreamResponse),
      })),
    };
  }

  private captured(message: { headers: RawHeaders; body: string }): CapturedMessage {
    return {
      headers: capturedHeaders(message.headers, this.credentialSecrets),
      body: capturedBody(message.body, this.credentialSecrets),
    };
  }

  private closeAttempt(
    failureReason: AttemptRecord["failureReason"],
    upstreamStatus: number | null,
  ): void {
    if (!this.openAttempt) {
      return;
    }
    const { target, upstreamProtocol, startedAt, startedMs, upstreamRequestId } = this.openAttempt;
    this.attempts.push({
      startedAt: startedAt.toISOString(),
      ...servingTargetOf(target),
      upstreamProtocol,
      upstreamStatus,
      failureReason,
      durationMs: elapsedSince(startedMs),
      upstreamRequestId,
    });
    this.openAttempt = null;
  }
}

function servingTargetOf({ route, upstreamModel, providerAccount }: AttemptTarget): ServingTarget {
  return {
    routeId: route?.id ?? null,
    upstreamModelId: upstreamModel.id,
    upstreamModelName: upstreamModel.upstreamModelId,
    providerSlug: upstreamModel.provider.slug,
    providerName: upstreamModel.provider.name,
    providerAccountId: providerAccount.id,
    providerAccountName: providerAccount.name,
  };
}

function elapsedSince(startMs: number): number {
  return Math.round(performance.now() - startMs);
}
