import { Injectable } from "@nestjs/common";
import { HttpClient, type HttpResponse } from "@nestjs/http-client";
import type { AttemptFailureReason } from "../db/schema.js";
import { AttemptFailedError, ClientCancelledError } from "./attempt-failure.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "./internal-format.js";
import {
  type UpstreamHttpRequest,
  type UpstreamProtocolConverter,
  UpstreamProtocolError,
  type UpstreamTarget,
} from "./protocols/upstream-protocol-converter.js";

/** Spec "Fallback" defaults; a Route may override each. */
export const DEFAULT_TIMEOUTS: AttemptTimeouts = {
  connectMs: 10_000,
  firstTokenMs: 60_000,
  totalMs: 600_000,
};

export interface AttemptTimeouts {
  /** Until the upstream's response headers arrive. */
  connectMs: number;
  /** From the headers until the first stream event (streams only). */
  firstTokenMs: number;
  /** The whole Attempt, body included. */
  totalMs: number;
}

/** Everything one Attempt needs: what to send, where, and with which credentials. */
export interface UpstreamCall {
  converter: UpstreamProtocolConverter;
  request: InferenceRequest;
  target: UpstreamTarget;
  /** The Provider Account's credentials, from `upstreamAuthHeaders`. */
  authHeaders: Record<string, string>;
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
      const response = await this.send(call, deadlines);
      return call.converter.parseResponse(parseJsonBody(await response.data.text()));
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
      const response = await this.send(call, deadlines);
      const body = response.data.body;
      if (!body) {
        throw new UpstreamProtocolError("The upstream stream has no body");
      }
      deadlines.start("firstTokenMs");
      const events = call.converter.parseStream(body)[Symbol.asyncIterator]();
      const first = await events.next();
      deadlines.stop("firstTokenMs");
      return this.restOfStream(first, events, deadlines);
    } catch (error) {
      deadlines.finish();
      throw deadlines.failureOf(error, false);
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

  private async send(
    call: UpstreamCall,
    deadlines: AttemptDeadlines,
  ): Promise<HttpResponse<Response>> {
    const written: UpstreamHttpRequest = call.converter.writeRequest(call.request, call.target);
    deadlines.start("connectMs");
    const response = await this.http.post<Response>(written.url, {
      body: written.body,
      headers: { ...written.headers, ...call.authHeaders },
      responseType: "response",
      signal: deadlines.signal,
      // Fallback across Provider Accounts and Routes is the gateway's job.
      retry: false,
      throwOnHttpError: false,
      redirect: "error",
    });
    deadlines.stop("connectMs");
    if (!response.ok) {
      throw await failedResponse(response);
    }
    return response;
  }
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

async function failedResponse(response: HttpResponse<Response>): Promise<AttemptFailedError> {
  const upstreamResponse = {
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.data.text(),
  };
  return new AttemptFailedError(
    failureReasonOf(response.status),
    response.status,
    `The upstream answered ${response.status}`,
    upstreamResponse,
  );
}

function failureReasonOf(status: number): AttemptFailureReason {
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
