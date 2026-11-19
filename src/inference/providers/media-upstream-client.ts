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

  generate<Request, Result>(
    call: MediaUpstreamCall<Request, Result>,
  ): Promise<MediaOutcome<Result>> {
    const failureReasonOf = (status: number, body: string): AttemptFailureReason =>
      call.protocol.failureReasonOf(status, body);
    return this.exchange({ ...call, failureReasonOf }, (exchange) =>
      call.protocol.generate(call.request, call.target, exchange),
    );
  }

  /**
   * Runs `use` with the I/O of one Attempt, under its deadline. Also how a
   * Video Job's poll makes its one call, outside the Fallback loop.
   */
  async exchange<Answer>(
    connection: MediaConnection,
    use: (exchange: MediaExchange) => Promise<Answer>,
  ): Promise<Answer> {
    const deadlines = new AttemptDeadlines(connection.timeouts, connection.clientSignal);
    deadlines.start("totalMs");
    try {
      return await use({
        postJson: (url, body, headers = {}) =>
          this.send(connection, url, deadlines.signal, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json", ...headers },
          }),
        getJson: (url) =>
          this.send(connection, url, deadlines.signal, { method: "GET", headers: {} }),
        fetchMedia: (url) => this.fetcher.fetch(url, deadlines.signal),
      });
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
  ): Promise<unknown> {
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
    if (!response.ok) {
      throw new AttemptFailedError(
        connection.failureReasonOf(response.status, text),
        response.status,
        `The upstream answered ${response.status}`,
        { headers: Object.fromEntries(response.headers.entries()), body: text },
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new UpstreamProtocolError("The upstream answered with a body that is not JSON", {
        cause: error,
      });
    }
  }
}
