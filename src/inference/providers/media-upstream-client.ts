import { Injectable } from "@nestjs/common";
import { HttpClient } from "@nestjs/http-client";
import { GATEWAY_USER_AGENT } from "@/libs/models/gateway-version.js";
import { AttemptFailedError } from "../models/attempt-failure.js";
import type {
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "../models/media-kind.js";
import { UpstreamProtocolError } from "../protocols/upstream-protocol-converter.js";
import { AttemptDeadlines, type AttemptTimeouts } from "./upstream-client.js";
import { MediaFetcher } from "./media-fetcher.js";

/** Everything one media Attempt needs: what to send, where, and with which credentials. */
export interface MediaUpstreamCall<Request, Result> {
  protocol: MediaUpstreamProtocol<Request, Result>;
  request: Request;
  target: MediaUpstreamTarget;
  /** The Provider Account's credential, from `upstreamAuthHeaders`, with an OAuth Login's identity. */
  authHeaders: Record<string, string>;
  /** Only `totalMs` applies: a media answer arrives whole, and its files are fetched within it. */
  timeouts: AttemptTimeouts;
  /** Aborts when the client disconnects. */
  clientSignal: AbortSignal;
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
  ): Promise<MediaOutcome<Result>> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start("totalMs");
    try {
      return await call.protocol.generate(call.request, call.target, {
        postJson: (url, body) => this.postJson(call, url, body, deadlines.signal),
        fetchMedia: (url) => this.fetcher.fetch(url, deadlines.signal),
      });
    } catch (error) {
      throw deadlines.failureOf(error, false);
    } finally {
      deadlines.finish();
    }
  }

  private async postJson<Request, Result>(
    call: MediaUpstreamCall<Request, Result>,
    url: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.http.post<Response>(url, {
      body: JSON.stringify(body),
      headers: {
        "user-agent": GATEWAY_USER_AGENT,
        "content-type": "application/json",
        ...call.authHeaders,
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
        call.protocol.failureReasonOf(response.status, text),
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
