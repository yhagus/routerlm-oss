import { Injectable } from "@nestjs/common";
import { HttpClient, type HttpResponse } from "@nestjs/http-client";
import { storedProviderQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
import type { AttemptFailureReason } from "@/db/schemas/index.js";
import { GATEWAY_USER_AGENT } from "@/libs/models/gateway-version.js";
import { AttemptFailedError, ClientCancelledError } from "../models/attempt-failure.js";
import { type ExhaustedErrorCode, isQuotaExhaustedError } from "../models/quota-exhausted-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../models/internal-format.js";
import {
  type UpstreamHttpRequest,
  type UpstreamProtocolConverter,
  UpstreamProtocolError,
  type UpstreamTarget,
} from "../protocols/upstream-protocol-converter.js";
import { gatherStream } from "../protocols/gather-stream.js";

/** Spec "Fallback" defaults; a Route may override each. */
export const DEFAULT_TIMEOUTS: AttemptTimeouts = {
  connectMs: 10_000,
  firstTokenMs: 60_000,
  totalMs: 600_000,
};

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
   * identity an OAuth Login presents. They override the converter's headers
   * and the gateway's own User-Agent.
   */
  authHeaders: Record<string, string>;
  /** The client's own headers the Provider's `forwardedClientHeaders` quirk asks for; they never override the credential. */
  forwardedHeaders: Record<string, string>;
  timeouts: AttemptTimeouts;
  /** Aborts when the client disconnects. */
  clientSignal: AbortSignal;
}

type Deadline = keyof AttemptTimeouts;

/** The abort reason our own timers use, to tell a timeout from a client disconnect. */
class DeadlineExceeded extends Error {
  constructor(readonly deadline: Deadline) {
    super(`Upstream deadline exceeded: ${deadline}`);
  }
}

/** One AbortController for the Attempt, aborted by the client or by whichever timer fires first. */
class AttemptDeadlines {
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
    const failureReason: AttemptFailureReason = whileStreaming
      ? "stream_interrupted"
      : error instanceof UpstreamProtocolError
        ? "server_error"
        : "connection_error";
    return new AttemptFailedError(failureReason, null, describe(error), null, { cause: error });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Makes one Attempt: sends the translated request to the upstream and reads
 * the answer back into the internal format. Throws AttemptFailedError (with
 * the Fallback reason) or ClientCancelledError; never retries.
 */
@Injectable()
export class UpstreamClient {
  constructor(private readonly http: HttpClient) {}

  async complete(call: UpstreamCall): Promise<InferenceResponse> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start("totalMs");
    try {
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      if (written.isAnsweredAsStream) {
        return await gatherStream(call.converter.parseStream(streamBodyOf(response)));
      }
      const body = await response.data.text();
      // MiniMax may refuse an Exhausted Provider Account with HTTP 200 and an
      // error code in the body.
      if (isQuotaExhaustedError(body, exhaustedErrorCodesOf(call.target))) {
        throw new AttemptFailedError(
          "exhausted",
          response.status,
          `The upstream answered ${response.status} with an Exhausted error code`,
          { headers: Object.fromEntries(response.headers.entries()), body },
        );
      }
      return call.converter.parseResponse(parseJsonBody(body));
    } catch (error) {
      throw deadlines.failureOf(error, false);
    } finally {
      deadlines.finish();
    }
  }

  /**
   * Resolves once the first stream event has arrived, so that a failure
   * before anything reaches the client is still an ordinary Attempt failure.
   * Later failures are thrown from the returned iterable.
   */
  async openStream(call: UpstreamCall): Promise<AsyncIterable<InferenceStreamEvent>> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start("totalMs");
    try {
      deadlines.start("connectMs");
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      deadlines.stop("connectMs");
      const body = streamBodyOf(response);
      deadlines.start("firstTokenMs");
      const events = call.converter.parseStream(body)[Symbol.asyncIterator]();
      const first = await events.next();
      deadlines.stop("firstTokenMs");
      return this.restOfStream(first, events, deadlines);
    } catch (error) {
      // Read the failure before finish(): finish() aborts with ClientCancelledError,
      // which would hide an upstream error status and stop the Fallback.
      const failure = deadlines.failureOf(error, false);
      deadlines.finish();
      throw failure;
    }
  }

  private async *restOfStream(
    first: IteratorResult<InferenceStreamEvent>,
    events: AsyncIterator<InferenceStreamEvent>,
    deadlines: AttemptDeadlines,
  ): AsyncIterable<InferenceStreamEvent> {
    try {
      let next = first;
      while (!next.done) {
        yield next.value;
        next = await events.next();
      }
    } catch (error) {
      throw deadlines.failureOf(error, true);
    } finally {
      deadlines.finish();
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
  return storedProviderQuirksSchema.parse(target.quirks).exhaustedErrorCodes ?? [];
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
