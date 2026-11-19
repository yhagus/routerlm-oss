import { Injectable } from "@nestjs/common";
import { HttpClient } from "@nestjs/http-client";
import { GATEWAY_USER_AGENT } from "@/libs/models/gateway-version.js";
import { AttemptFailedError } from "../models/attempt-failure.js";
import type { AttemptFailureReason } from "@/db/schemas/index.js";
import type {
  MediaExchange,
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "../models/media-kind.js";
import { upstreamRequestIdOf } from "../models/upstream-request-id.js";
import { UpstreamProtocolError } from "../protocols/upstream-protocol-converter.js";
import { AttemptDeadlines, type AttemptTimeouts } from "./upstream-client.js";
import { MediaFetcher } from "./media-fetcher.js";

/** How one media Attempt reaches the Provider: its credential, deadline and error codes. */
export interface MediaConnection {
  /** The Provider Account's credential, from `upstreamAuthHeaders`, with an OAuth Login's identity. */
  authHeaders: Record<string, string>;
  /** Only `totalMs` applies: a media answer arrives whole, and its files are fetched within it. */
  timeouts: AttemptTimeouts;
  /** Aborts when the client disconnects. */
  clientSignal: AbortSignal;
  /** The Fallback reason of a non-2xx answer (the Protocol's `failureReasonOf`). */
  failureReasonOf(status: number, body: string): AttemptFailureReason;
}

/** A media Attempt's outcome, with the first request id the Provider returned (null when none). */
export interface AnsweredMediaAttempt<Result> extends MediaOutcome<Result> {
  upstreamRequestId: string | null;
}

/** Everything one media Attempt needs: what to send, where, and with which credentials. */
export interface MediaUpstreamCall<Request, Result> extends Omit<
  MediaConnection,
  "failureReasonOf"
> {
  protocol: MediaUpstreamProtocol<Request, Result>;
  request: Request;
  target: MediaUpstreamTarget;
}

/**
 * Makes one media Attempt: lets the Protocol call its upstream and fetch the
 * files it generated, all under the Attempt's deadline. Throws
 * AttemptFailedError (with the Fallback reason) or ClientCancelledError;
 * never retries.
 */
@Injectable()
export class MediaUpstreamClient {
  constructor(
    private readonly http: HttpClient,
    private readonly fetcher: MediaFetcher,
  ) {}

  async generate<Request, Result>(
    call: MediaUpstreamCall<Request, Result>,
  ): Promise<AnsweredMediaAttempt<Result>> {
    const failureReasonOf = (status: number, body: string): AttemptFailureReason =>
      call.protocol.failureReasonOf(status, body);
    const { answer, upstreamRequestId } = await this.exchangeNoting(
      { ...call, failureReasonOf },
      (exchange) => call.protocol.generate(call.request, call.target, exchange),
    );
    return { ...answer, upstreamRequestId };
  }

  /**
   * Runs `use` with the I/O of one Attempt, under its deadline. Also how a
   * Video Job's poll makes its one call, outside the Fallback loop.
   */
  async exchange<Answer>(
    connection: MediaConnection,
    use: (exchange: MediaExchange) => Promise<Answer>,
  ): Promise<Answer> {
    const { answer } = await this.exchangeNoting(connection, use);
    return answer;
  }

  /** As `exchange`, noting the first request id the Provider returned (null when none). */
  private async exchangeNoting<Answer>(
    connection: MediaConnection,
    use: (exchange: MediaExchange) => Promise<Answer>,
  ): Promise<{ answer: Answer; upstreamRequestId: string | null }> {
    const deadlines = new AttemptDeadlines(connection.timeouts, connection.clientSignal);
    deadlines.start("totalMs");
    let upstreamRequestId: string | null = null;
    const sendNoting = async (
      url: string,
      request: { method: "GET" | "POST"; body?: string; headers: Record<string, string> },
    ): Promise<unknown> => {
      const answered = await this.send(connection, url, deadlines.signal, request);
      upstreamRequestId ??= answered.upstreamRequestId;
      return answered.body;
    };
    try {
      const answer = await use({
        postJson: (url, body, headers = {}) =>
          sendNoting(url, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json", ...headers },
          }),
        getJson: (url) => sendNoting(url, { method: "GET", headers: {} }),
        fetchMedia: (url) => this.fetcher.fetch(url, deadlines.signal),
      });
      return { answer, upstreamRequestId };
    } catch (error) {
      throw deadlines.failureOf(error, false);
    } finally {
      deadlines.finish();
    }
  }

  private async send(
    connection: MediaConnection,
    url: string,
    signal: AbortSignal,
    request: { method: "GET" | "POST"; body?: string; headers: Record<string, string> },
  ): Promise<{ body: unknown; upstreamRequestId: string | null }> {
    const response = await this.http.request<Response>(url, {
      method: request.method,
      body: request.body,
      headers: {
        "user-agent": GATEWAY_USER_AGENT,
        ...request.headers,
        ...connection.authHeaders,
      },
      responseType: "response",
      signal,
      // Fallback across Provider Accounts and Routes is the gateway's job.
      retry: false,
      throwOnHttpError: false,
      redirect: "error",
    });
    const text = await response.data.text();
    const headers = Object.fromEntries(response.headers.entries());
    if (!response.ok) {
      throw new AttemptFailedError(
        connection.failureReasonOf(response.status, text),
        response.status,
        `The upstream answered ${response.status}`,
        { headers, body: text },
      );
    }
    try {
      return { body: JSON.parse(text), upstreamRequestId: upstreamRequestIdOf(headers) };
    } catch (error) {
      throw new UpstreamProtocolError("The upstream answered with a body that is not JSON", {
        cause: error,
      });
    }
  }
}
