import { randomUUID } from "node:crypto";
import type { ClientProtocol, GatewayErrorCode } from "../../db/schemas/index.js";
import {
  capturedBody,
  capturedHeaders,
  type RawHeaders,
} from "../../error-captures/models/captured-content.js";
import type {
  AttemptRecord,
  CapturedMessage,
  ErrorCaptureRecord,
  ServedBy,
  UsageCaller,
  UsageJob,
} from "../../usage/models/usage-job.js";
import type { AttemptFailedError, UpstreamFailureResponse } from "./attempt-failure.js";
import type { GatewayError } from "./gateway-error.js";
import type { TokenUsage } from "./internal-format.js";
import type { AttemptTarget } from "./route-selection.js";

/**
 * The upstream status recorded for an Attempt that answered. UpstreamClient
 * only tells that the status was 2xx, and the Providers we speak to answer 200.
 */
const ANSWERED_UPSTREAM_STATUS = 200;
const FIRST_ERROR_STATUS = 400;

interface OpenAttempt {
  target: AttemptTarget;
  startedAt: Date;
  startedMs: number;
  hasAnswered: boolean;
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
  private errorCode: GatewayErrorCode | null = null;
  private readonly attempts: AttemptRecord[] = [];
  private openAttempt: OpenAttempt | null = null;
  private servedBy: ServedBy | null = null;
  private usage: TokenUsage | null = null;
  private timeToFirstTokenMs: number | null = null;
  private responseBytes = 0;
  private clientRequest: ClientRequest | null = null;
  private readonly failedAttempts: FailedAttempt[] = [];
  /** Redacted from every Error Capture of this request. */
  private readonly providerAccountKeys: string[] = [];

  constructor(
    private readonly caller: UsageCaller,
    private readonly clientProtocol: ClientProtocol,
    private readonly requestBytes: number,
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

  modelResolved(modelId: string): void {
    this.modelId = modelId;
  }

  attemptStarted(target: AttemptTarget, providerAccountKey: string): void {
    this.providerAccountKeys.push(providerAccountKey);
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
    if (!this.openAttempt) {
      return;
    }
    this.failedAttempts.push({
      attemptIndex: this.attempts.length,
      upstreamResponse: failure.upstreamResponse,
    });
    const hasAnswered = this.openAttempt.hasAnswered;
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
      headers: capturedHeaders(message.headers, this.providerAccountKeys),
      body: capturedBody(message.body, this.providerAccountKeys),
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
