import { Injectable } from "@nestjs/common";
import { HttpClient, type HttpResponse } from "@nestjs/http-client";
import type { AttemptFailureReason } from "@/db/schemas/index.js";
import { GATEWAY_USER_AGENT } from "@/libs/models/gateway-version.js";
import { AttemptFailedError, ClientCancelledError } from "@/inference/models/attempt-failure.js";
import {
  type ExhaustedErrorCode,
  isQuotaExhaustedError,
} from "@/inference/models/quota-exhausted-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "@/inference/models/internal-format.js";
import {
  parseUpstreamStream,
  type UpstreamHttpRequest,
  type UpstreamProtocolConverter,
  UpstreamProtocolError,
  type UpstreamStreamParser,
  type UpstreamTarget,
} from "@/inference/protocols/upstream-protocol-converter.js";
import type { Destination } from "@/inference/models/destination.js";
import type { SnapshotRoute } from "@/snapshot/models/snapshot.js";
import { upstreamRequestIdOf } from "@/inference/models/upstream-request-id.js";
import { gatherStream } from "@/inference/protocols/gather-stream.js";
import {
  type ServerSentEvent,
  ServerSentEventDecoder,
} from "@/inference/protocols/server-sent-events.js";

/** Spec "Fallback" defaults; a Route may override each. */
export const DEFAULT_TIMEOUTS: AttemptTimeouts = {
  connectMs: 10_000,
  firstTokenMs: 60_000,
  totalMs: 600_000,
};

/** How long an Attempt on `route` may take in all: a Probe's own limit, else the Route's, else the default. */
export function totalTimeoutMsOf(destination: Destination, route: SnapshotRoute | null): number {
  if (destination.kind === "probe") {
    return destination.totalTimeoutMs;
  }
  return route?.totalTimeoutMs ?? DEFAULT_TIMEOUTS.totalMs;
}

/**
 * fetch exposes neither the TCP/TLS connection nor the moment the request is
 * sent, so the first thing an Attempt can observe is the response headers.
 * A streaming upstream sends them as soon as it accepts the request, but a
 * non-stream one sends them only with its finished answer, which can take
 * minutes for a long or reasoning-heavy reply. So a non-stream Attempt is
 * bound by `totalMs` alone; a stream gets all three.
 */
export interface AttemptTimeouts {
  /** Streams only: until the upstream's response headers arrive. */
  connectMs: number;
  /** Streams only: from the headers until the first stream event. */
  firstTokenMs: number;
  /** The whole Attempt, body included. */
  totalMs: number;
}

/** Everything one Attempt needs: what to send, where, and with which credentials. */
export interface UpstreamCall {
  converter: UpstreamProtocolConverter;
  request: InferenceRequest;
  target: UpstreamTarget;
  /**
   * The Provider Account's credential, from `upstreamAuthHeaders`, with the
   * identity an OAuth Login presents. They override every other header: the
   * Provider's `fixedHeaders`, the converter's, the forwarded client headers
   * and the gateway's own User-Agent, in that order of precedence.
   */
  authHeaders: Record<string, string>;
  /** The client's own headers the Provider's `forwardedClientHeaders` quirk asks for; they never override the credential. */
  forwardedHeaders: Record<string, string>;
  timeouts: AttemptTimeouts;
  /** Aborts when the client disconnects. */
  clientSignal: AbortSignal;
}

/** A non-stream Attempt's answer, with the request id the Provider returned (null when none). */
export interface CompletedAttempt {
  response: InferenceResponse;
  upstreamRequestId: string | null;
}

type Deadline = keyof AttemptTimeouts;

/** The abort reason our own timers use, to tell a timeout from a client disconnect. */
class DeadlineExceeded extends Error {
  constructor(readonly deadline: Deadline) {
    super(`Upstream deadline exceeded: ${deadline}`);
  }
}

/** One AbortController for the Attempt, aborted by the client or by whichever timer fires first. Media Attempts share it. */
export class AttemptDeadlines {
  private readonly controller = new AbortController();
  private readonly timers = new Map<Deadline, NodeJS.Timeout>();
  private readonly onClientAbort = (): void => this.controller.abort(new ClientCancelledError());

  constructor(
    private readonly timeouts: AttemptTimeouts,
    private readonly clientSignal: AbortSignal,
  ) {
    if (clientSignal.aborted) {
      this.onClientAbort();
    }
    clientSignal.addEventListener("abort", this.onClientAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(deadline: Deadline): void {
    const ms = this.timeouts[deadline];
    this.timers.set(
      deadline,
      setTimeout(() => this.controller.abort(new DeadlineExceeded(deadline)), ms),
    );
  }

  stop(deadline: Deadline): void {
    clearTimeout(this.timers.get(deadline));
    this.timers.delete(deadline);
  }

  /** Stops every timer and releases the upstream connection if it is still open. */
  finish(): void {
    for (const deadline of this.timers.keys()) {
      this.stop(deadline);
    }
    this.clientSignal.removeEventListener("abort", this.onClientAbort);
    this.controller.abort(new ClientCancelledError());
  }

  /** What an error thrown while this Attempt ran means, in Fallback terms. */
  failureOf(error: unknown, whileStreaming: boolean): Error {
    const reason: unknown = this.signal.aborted ? this.signal.reason : undefined;
    if (reason instanceof ClientCancelledError) {
      return reason;
    }
    if (reason instanceof DeadlineExceeded) {
      return new AttemptFailedError("timeout", null, reason.message, null, { cause: error });
    }
    if (error instanceof AttemptFailedError) {
      return error;
    }
    return new AttemptFailedError(
      failureReasonOfThrown(error, whileStreaming),
      null,
      describe(error),
      null,
      {
        cause: error,
      },
    );
  }
}

/** The Fallback reason for an error that isn't already an Attempt failure. */
function failureReasonOfThrown(error: unknown, whileStreaming: boolean): AttemptFailureReason {
  if (whileStreaming) return "stream_interrupted";
  if (error instanceof UpstreamProtocolError) return "server_error";
  return "connection_error";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads one upstream stream body into internal events, one network read at a
 * time, with no async stage between the socket and the parser.
 */
class UpstreamEventReader {
  private readonly decoder = new ServerSentEventDecoder();
  private isEnded = false;
  /** A failure that came in the same read as events before it, thrown once those went out. */
  private deferredFailure: { error: unknown } | null = null;

  constructor(
    private readonly body: ReadableStreamDefaultReader<Uint8Array>,
    private readonly parser: UpstreamStreamParser,
  ) {}

  /**
   * The events of the next network read that carried any, or null once the
   * body or the Protocol's end marker ended the stream.
   */
  async nextBatch(): Promise<InferenceStreamEvent[] | null> {
    if (this.deferredFailure) {
      throw this.deferredFailure.error;
    }
    while (!this.isEnded) {
      const read = await this.body.read();
      const batch = read.done ? this.lastEvents() : this.eventsOf(this.decoder.push(read.value));
      if (batch.length > 0) {
        return batch;
      }
    }
    return null;
  }

  private eventsOf(serverSentEvents: ServerSentEvent[]): InferenceStreamEvent[] {
    const events: InferenceStreamEvent[] = [];
    try {
      for (const serverSentEvent of serverSentEvents) {
        events.push(...this.parser.parse(serverSentEvent));
        if (this.parser.isDone) {
          // Whatever follows the end marker is ignored.
          this.isEnded = true;
          break;
        }
      }
    } catch (error) {
      this.failAfter(events, error);
    }
    return events;
  }

  private lastEvents(): InferenceStreamEvent[] {
    const events = this.eventsOf(this.decoder.end());
    if (this.isEnded) {
      return events;
    }
    this.isEnded = true;
    try {
      events.push(...this.parser.end());
    } catch (error) {
      this.failAfter(events, error);
    }
    return events;
  }

  /** The events before a failure still go out, as one batch; the failure ends the stream after them. */
  private failAfter(events: InferenceStreamEvent[], error: unknown): void {
    if (events.length === 0) {
      throw error;
    }
    this.deferredFailure = { error };
    this.isEnded = true;
  }
}

/**
 * An upstream stream whose first events have arrived. Its reader calls
 * `nextBatch` until it returns null, and `close` when it stops early.
 */
export class UpstreamStream {
  constructor(
    private firstBatch: InferenceStreamEvent[] | null,
    private readonly events: UpstreamEventReader,
    private readonly deadlines: AttemptDeadlines,
    /** The request id the Provider returned with the stream's headers; null when none. */
    readonly upstreamRequestId: string | null,
  ) {}

  /**
   * The internal events of the next network read, in order, or null once the
   * stream has ended. Throws AttemptFailedError (`stream_interrupted`,
   * `timeout`) or ClientCancelledError.
   */
  async nextBatch(): Promise<InferenceStreamEvent[] | null> {
    const first = this.firstBatch;
    if (first) {
      this.firstBatch = null;
      return first;
    }
    try {
      const batch = await this.events.nextBatch();
      if (batch === null) {
        this.close();
      }
      return batch;
    } catch (error) {
      // Read the failure before close(), which aborts with ClientCancelledError.
      const failure = this.deadlines.failureOf(error, true);
      this.close();
      throw failure;
    }
  }

  /** Stops the timers and releases the upstream connection; calling it again does nothing. */
  close(): void {
    this.deadlines.finish();
  }
}

/**
 * Makes one Attempt: sends the translated request to the upstream and reads
 * the answer back into the internal format. Throws AttemptFailedError (with
 * the Fallback reason) or ClientCancelledError; never retries.
 */
@Injectable()
export class UpstreamClient {
  constructor(private readonly http: HttpClient) {}

  async complete(call: UpstreamCall): Promise<CompletedAttempt> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start("totalMs");
    try {
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      const headers = Object.fromEntries(response.headers.entries());
      const upstreamRequestId = upstreamRequestIdOf(headers);
      if (written.isAnsweredAsStream) {
        const gathered = await gatherStream(
          parseUpstreamStream(() => call.converter.startStream(), streamBodyOf(response)),
        );
        return { response: gathered, upstreamRequestId };
      }
      const body = await response.data.text();
      // MiniMax may refuse an Exhausted Provider Account with HTTP 200 and an
      // error code in the body.
      if (isQuotaExhaustedError(body, exhaustedErrorCodesOf(call.target))) {
        throw new AttemptFailedError(
          "exhausted",
          response.status,
          `The upstream answered ${response.status} with an Exhausted error code`,
          { headers, body },
        );
      }
      return { response: call.converter.parseResponse(parseJsonBody(body)), upstreamRequestId };
    } catch (error) {
      throw deadlines.failureOf(error, false);
    } finally {
      deadlines.finish();
    }
  }

  /**
   * Resolves once the first stream event has arrived, so that a failure
   * before anything reaches the client is still an ordinary Attempt failure.
   * Later failures are thrown from the returned stream's `nextBatch`.
   */
  async openStream(call: UpstreamCall): Promise<UpstreamStream> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start("totalMs");
    try {
      deadlines.start("connectMs");
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      deadlines.stop("connectMs");
      const events = new UpstreamEventReader(
        streamBodyOf(response).getReader(),
        call.converter.startStream(),
      );
      deadlines.start("firstTokenMs");
      const firstBatch = await events.nextBatch();
      deadlines.stop("firstTokenMs");
      return new UpstreamStream(
        firstBatch,
        events,
        deadlines,
        upstreamRequestIdOf(Object.fromEntries(response.headers.entries())),
      );
    } catch (error) {
      // Read the failure before finish(): finish() aborts with ClientCancelledError,
      // which would hide an upstream error status and stop the Fallback.
      const failure = deadlines.failureOf(error, false);
      deadlines.finish();
      throw failure;
    }
  }

  /** Resolves once the response headers have arrived. */
  private async send(
    call: UpstreamCall,
    written: UpstreamHttpRequest,
    signal: AbortSignal,
  ): Promise<HttpResponse<Response>> {
    const response = await this.http.post<Response>(written.url, {
      body: written.body,
      headers: {
        "user-agent": GATEWAY_USER_AGENT,
        ...call.forwardedHeaders,
        ...written.headers,
        ...call.target.quirks.fixedHeaders,
        ...call.authHeaders,
      },
      responseType: "response",
      signal,
      // Fallback across Provider Accounts and Routes is the gateway's job.
      retry: false,
      throwOnHttpError: false,
      redirect: "error",
    });
    if (!response.ok) {
      throw await failedResponse(response, exhaustedErrorCodesOf(call.target));
    }
    return response;
  }
}

function streamBodyOf(response: HttpResponse<Response>): ReadableStream<Uint8Array> {
  const body = response.data.body;
  if (!body) {
    throw new UpstreamProtocolError("The upstream stream has no body");
  }
  return body;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UpstreamProtocolError("The upstream answered with a body that is not JSON", {
      cause: error,
    });
  }
}

function exhaustedErrorCodesOf(target: UpstreamTarget): ExhaustedErrorCode[] {
  return target.quirks.exhaustedErrorCodes ?? [];
}

async function failedResponse(
  response: HttpResponse<Response>,
  exhaustedErrorCodes: ExhaustedErrorCode[],
): Promise<AttemptFailedError> {
  const upstreamResponse = {
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.data.text(),
  };
  return new AttemptFailedError(
    failureReasonOf(response.status, upstreamResponse.body, exhaustedErrorCodes),
    response.status,
    `The upstream answered ${response.status}`,
    upstreamResponse,
  );
}

function failureReasonOf(
  status: number,
  body: string,
  exhaustedErrorCodes: ExhaustedErrorCode[],
): AttemptFailureReason {
  if (isQuotaExhaustedError(body, exhaustedErrorCodes)) {
    return "exhausted";
  }
  return failureReasonOfStatus(status);
}

/** The Fallback reason an upstream's non-2xx status means when nothing in its body says more. */
export function failureReasonOfStatus(status: number): AttemptFailureReason {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "bad_request";
}
