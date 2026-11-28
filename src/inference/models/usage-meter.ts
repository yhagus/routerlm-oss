import { randomUUID } from 'node:crypto';
import type {
  ClientProtocol,
  ErrorOrigin,
  FinishReason,
  GatewayErrorCode,
  UpstreamProtocol,
} from '@/db/schemas';
import {
  capturedBody,
  capturedHeaders,
  type RawHeaders,
} from '@/error-captures/models/captured-content';
import type { RequestSender } from '@/libs/models/client-connection';
import type {
  AttemptRecord,
  CapturedMessage,
  ErrorCaptureRecord,
  MediaUnits,
  SentParameters,
  ServedBy,
  ServingTarget,
  UsageCaller,
  UsageJob,
} from '@/usage/models/usage-job';
import type { WaitingCaller, WaitingRequester } from '@/inference/schemas/waiting-request.schema';
import type { AttemptFailedError, UpstreamFailureResponse } from './attempt-failure';
import type { GatewayError } from './gateway-error';
import type {
  InferenceResponse,
  InferenceStreamEvent,
  StopReason,
  TokenUsage,
} from './internal-format';
import type { AttemptTarget } from './route-selection';
import { pricesForRequest } from './request-prices';
import { type SentServiceTier, serviceTierOfWireValue } from './service-tier';

const FIRST_ERROR_STATUS = 400;

const FINISH_REASONS = {
  end: 'stop',
  'stop-sequence': 'stop',
  'max-tokens': 'length',
  'tool-calls': 'tool_calls',
  'content-filter': 'content_filter',
  other: 'other',
} as const satisfies Record<StopReason, FinishReason>;

interface OpenAttempt {
  target: AttemptTarget;
  upstreamProtocol: UpstreamProtocol;
  sentServiceTier: SentServiceTier | null;
  startedAt: Date;
  startedMs: number;
  answeredStatus: number | null;
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
  private requestedModelName: string | null = null;
  private errorCode: GatewayErrorCode | null = null;
  private errorOrigin: ErrorOrigin | null = null;
  private readonly attempts: AttemptRecord[] = [];
  private openAttempt: OpenAttempt | null = null;
  private servedBy: ServedBy | null = null;
  private usage: TokenUsage | null = null;
  private units: MediaUnits | null = null;
  private timeToFirstTokenMs: number | null = null;
  private isReasoningStreamed = false;
  private finishReason: FinishReason | null = null;
  private sentParameters: SentParameters | null = null;
  private toolCount = 0;
  private toolCallCount = 0;
  private responseBytes = 0;
  private slotWaitMs = 0;
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

  toolsDefined(toolCount: number): void {
    this.toolCount = toolCount;
  }

  modelRequested(requestedModelName: string): void {
    this.requestedModelName = requestedModelName;
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
      answeredStatus: null,
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
      failureReason: 'exhausted',
      durationMs: 0,
      upstreamRequestId: null,
    });
  }

  attemptAnswered(upstreamStatus: number, upstreamRequestId: string | null): void {
    if (!this.openAttempt) {
      return;
    }
    this.openAttempt.answeredStatus = upstreamStatus;
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
  }

  parametersSent(sentParameters: SentParameters): void {
    this.sentParameters = sentParameters;
  }

  responseReceived(response: InferenceResponse): void {
    this.usageReported(response.usage, response.servedTierValue);
    this.finishReason = FINISH_REASONS[response.stopReason];
    this.toolCallCount = response.content.filter((part) => part.type === 'tool-call').length;
  }

  streamEventRelayed(event: InferenceStreamEvent): void {
    switch (event.type) {
      case 'text-delta':
      case 'tool-call-delta':
        this.outputStarted();
        break;
      case 'reasoning-delta':
        this.outputStarted();
        this.isReasoningStreamed = true;
        break;
      case 'tool-call-start':
        this.outputStarted();
        this.toolCallCount += 1;
        break;
      case 'finish':
        this.finishReason = FINISH_REASONS[event.stopReason];
        break;
      case 'usage':
        this.usageReported(event.usage, event.servedTierValue);
        break;
      case 'reasoning-signature':
        break;
    }
  }

  private outputStarted(): void {
    this.timeToFirstTokenMs ??= elapsedSince(this.receivedMs);
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
    this.closeAttempt(failure.reason, failure.upstreamStatus);
  }

  attemptInterrupted(): void {
    this.closeAttempt('stream_interrupted');
  }

  attemptSucceeded(): void {
    this.closeAttempt(null);
  }

  failedWith(error: GatewayError): void {
    this.errorCode = error.code;
    this.errorOrigin = error.origin;
  }

  failedInGateway(): void {
    this.errorOrigin = 'gateway';
  }

  finishWithError(error: GatewayError, envelope: unknown): UsageJob {
    this.failedWith(error);
    this.responseWritten(Buffer.byteLength(JSON.stringify(envelope)));
    return this.finish(error.status, false);
  }

  waitingRequester(): WaitingRequester {
    return {
      caller: waitingCallerOf(this.caller),
      requestedModelName: this.requestedModelName,
      isStreamed: this.isStreamed,
      clientIp: this.sender.clientIp,
      userAgent: this.sender.userAgent,
    };
  }

  slotWaited(durationMs: number): void {
    this.slotWaitMs += durationMs;
  }

  responseWritten(byteLength: number): void {
    this.responseBytes += byteLength;
  }

  finish(httpStatus: number, isCancelled: boolean): UsageJob {
    if (this.openAttempt) {
      this.closeAttempt(isCancelled ? 'cancelled' : null);
    }
    const hasSucceeded = !isCancelled && this.errorCode === null && httpStatus < FIRST_ERROR_STATUS;
    return {
      usageLogId: this.usageLogId,
      receivedAt: this.receivedAt.toISOString(),
      caller: this.caller,
      modelId: this.modelId,
      modelName: this.modelName,
      requestedModelName: this.requestedModelName,
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
      isReasoningStreamed: this.isReasoningStreamed,
      finishReason: hasSucceeded ? this.finishReason : null,
      sentParameters: this.sentParameters,
      toolCount: this.toolCount,
      toolCallCount: this.toolCallCount,
      durationMs: elapsedSince(this.receivedMs),
      slotWaitMs: Math.round(this.slotWaitMs),
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
        body: JSON.stringify(this.clientRequest.body) ?? '',
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
    failureReason: AttemptRecord['failureReason'],
    failureStatus: number | null = null,
  ): void {
    if (!this.openAttempt) {
      return;
    }
    const { target, upstreamProtocol, startedAt, startedMs, answeredStatus, upstreamRequestId } =
      this.openAttempt;
    this.attempts.push({
      startedAt: startedAt.toISOString(),
      ...servingTargetOf(target),
      upstreamProtocol,
      upstreamStatus: failureStatus ?? answeredStatus,
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

function waitingCallerOf(caller: UsageCaller): WaitingCaller {
  switch (caller.kind) {
    case 'api-key':
      return {
        kind: 'api-key',
        apiKeyId: caller.apiKeyId,
        customer: caller.customer
          ? { integrationId: caller.customer.integrationId, customerId: caller.customer.customerId }
          : null,
      };
    case 'playground':
      return { kind: 'playground', userId: caller.userId };
    case 'unidentified':
      return { kind: 'unidentified' };
  }
}
