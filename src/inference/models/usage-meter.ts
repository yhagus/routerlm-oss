import { randomUUID } from "node:crypto";
import type { ClientProtocol, ErrorOrigin, GatewayErrorCode } from "@/db/schemas/index.js";
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
import {
  pricesAtServiceTier,
  type SentServiceTier,
  serviceTierOfWireValue,
} from "./service-tier.js";

/**
 * The upstream status recorded for an Attempt that answered. UpstreamClient
 * only tells that the status was 2xx, and the Providers we speak to answer 200.
 */
const ANSWERED_UPSTREAM_STATUS = 200;
const FIRST_ERROR_STATUS = 400;

interface OpenAttempt {
  target: AttemptTarget;
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
  attemptIndex: number;
  upstreamResponse: UpstreamFailureResponse | null;
}

/**
 * Measures one inference request as it goes, for its Usage Log and Attempts
 * (spec "Records"). Its measurements are counts, sizes, ids and times. The
 * only content it holds is for an Error Capture, and the job carries it only
 * when the request or one of its Attempts failed (ADR 0004, ADR 0006).
 * `finish` turns it into the usage job.
 */
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
  /** Redacted from every Error Capture of this request. */
  private readonly credentialSecrets: string[] = [];

  constructor(
    private readonly caller: UsageCaller,
    private readonly clientProtocol: ClientProtocol,
    private readonly requestBytes: number,
    private readonly sender: RequestSender,
  ) {}

  /**
   * Keeps the client request in case it fails. Only called once the caller
   * is authenticated (a valid API Key, or a Playground session): requests
   * without either get no Error Capture (spec "Records").
   */
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

  /** `sentServiceTier` is the tier the Attempt asks for, null when it asks for none. */
  attemptStarted(target: AttemptTarget, sentServiceTier: SentServiceTier | null): void {
    this.openAttempt = {
      target,
      sentServiceTier,
      startedAt: new Date(),
      startedMs: performance.now(),
      hasAnswered: false,
      upstreamRequestId: null,
    };
  }

  /** The Provider Account key or access token an Attempt sends, to redact from Error Captures. */
  credentialUsed(secret: string): void {
    this.credentialSecrets.push(secret);
  }

  /**
   * Fallback skipped the target's Provider Account as Exhausted. Recorded as
   * an Attempt without an upstream call (no status, no duration), so the
   * Usage Log shows why the account did not serve the request.
   */
  attemptSkippedAsExhausted(target: AttemptTarget): void {
    this.attempts.push({
      startedAt: new Date().toISOString(),
      ...servingTargetOf(target),
      upstreamStatus: null,
      failureReason: "exhausted",
      durationMs: 0,
      upstreamRequestId: null,
    });
  }

  /**
   * The upstream answered: the whole response, or a stream's first event.
   * `upstreamRequestId` is the request id it returned, null when none.
   */
  attemptAnswered(upstreamRequestId: string | null): void {
    if (!this.openAttempt) {
      return;
    }
    this.openAttempt.hasAnswered = true;
    this.openAttempt.upstreamRequestId = upstreamRequestId;
    const { target } = this.openAttempt;
    const serviceTier = this.openAttempt.sentServiceTier?.tier ?? null;
    this.servedBy = {
      ...servingTargetOf(target),
      serviceTier,
      // Taken now, so a later price edit doesn't change this request's Cost.
      prices: pricesAtServiceTier(target.upstreamModel, serviceTier),
      unitPrices: target.upstreamModel.unitPrices,
    };
    if (this.isStreamed) {
      this.timeToFirstTokenMs = elapsedSince(this.receivedMs);
    }
  }

  /**
   * `servedTierValue` is the Service Tier the upstream says served the
   * request, as it spells it; it replaces the tier the Attempt sent.
   */
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
      prices: pricesAtServiceTier(upstreamModel, serviceTier),
    };
  }

  /** What the answering Attempt of a media Kind counted. */
  unitsCounted(units: MediaUnits): void {
    this.units = units;
  }

  attemptFailed(failure: AttemptFailedError): void {
    if (!this.openAttempt) {
      return;
    }
    this.failedAttempts.push({
      attemptIndex: this.attempts.length,
      upstreamResponse: failure.upstreamResponse,
    });
    // A stream that broke off keeps the request id its answer came with.
    this.openAttempt.upstreamRequestId =
      failure.upstreamRequestId ?? this.openAttempt.upstreamRequestId;
    const hasAnswered = this.openAttempt.hasAnswered;
    this.closeAttempt(
      failure.reason,
      failure.upstreamStatus ?? (hasAnswered ? ANSWERED_UPSTREAM_STATUS : null),
    );
  }

  /** The gateway refused what the answering Attempt streamed, so its stream broke off. */
  attemptInterrupted(): void {
    this.closeAttempt("stream_interrupted", ANSWERED_UPSTREAM_STATUS);
  }

  attemptSucceeded(): void {
    this.closeAttempt(null, ANSWERED_UPSTREAM_STATUS);
  }

  /** The error the client got, as a status or as a stream's error event. */
  failedWith(error: GatewayError): void {
    this.errorCode = error.code;
    this.errorOrigin = error.origin;
  }

  /** The request ended in an exception outside the error contract: a gateway bug. */
  failedInGateway(): void {
    this.errorOrigin = "gateway";
  }

  /** Finishes a request answered with `error`, whose body is the client Protocol's `envelope`. */
  finishWithError(error: GatewayError, envelope: unknown): UsageJob {
    this.failedWith(error);
    this.responseWritten(Buffer.byteLength(JSON.stringify(envelope)));
    return this.finish(error.status, false);
  }

  /** Counts `byteLength` more bytes of the response body as sent. */
  responseWritten(byteLength: number): void {
    this.responseBytes += byteLength;
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
      modelName: this.modelName,
      clientProtocol: this.clientProtocol,
      isStreamed: this.isStreamed,
      httpStatus,
      errorCode: this.errorCode,
      // A client leaving is no failure of anyone's (ADR 0031).
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

  /**
   * Spec "Records" and ADR 0006: every failed Attempt is captured, even one
   * Fallback recovered from. The client request alone is captured only when
   * the request failed before any Attempt did; a client leaving is not a failure.
   */
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
      request: this.captured({
        headers: this.clientRequest.headers,
        // Parsed by Nest already; undefined when the request had no body.
        body: JSON.stringify(this.clientRequest.body) ?? "",
      }),
      failedAttempts: this.failedAttempts.map(({ attemptIndex, upstreamResponse }) => ({
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
    const { target, startedAt, startedMs, upstreamRequestId } = this.openAttempt;
    this.attempts.push({
      startedAt: startedAt.toISOString(),
      ...servingTargetOf(target),
      upstreamStatus,
      failureReason,
      durationMs: elapsedSince(startedMs),
      upstreamRequestId,
    });
    this.openAttempt = null;
  }
}

/** The ids and names of what an Attempt tried, as its records copy them (ADR 0024). */
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
