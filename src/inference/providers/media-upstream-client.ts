import { Injectable } from '@nestjs/common';
import { HttpClient } from '@nestjs/http-client';
import { GATEWAY_USER_AGENT } from '@/libs/models/gateway-version';
import { AttemptFailedError } from '@/inference/models/attempt-failure';
import type { AttemptFailureReason } from '@/db/schemas';
import type {
  MediaExchange,
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from '@/inference/models/media-kind';
import { upstreamRequestIdOf } from '@/inference/models/upstream-request-id';
import { UpstreamProtocolError } from '@/inference/protocols/upstream-protocol-converter';
import { AttemptDeadlines, type AttemptTimeouts } from './upstream-client';
import { MediaFetcher } from './media-fetcher';

export interface MediaConnection {
  authHeaders: Record<string, string>;
  timeouts: AttemptTimeouts;
  clientSignal: AbortSignal;
  failureReasonOf(status: number, body: string): AttemptFailureReason;
}

interface UpstreamReply {
  upstreamStatus: number;
  upstreamRequestId: string | null;
}

export interface AnsweredMediaAttempt<Result> extends MediaOutcome<Result>, UpstreamReply {}

export interface MediaUpstreamCall<Request, Result> extends Omit<
  MediaConnection,
  'failureReasonOf'
> {
  protocol: MediaUpstreamProtocol<Request, Result>;
  request: Request;
  target: MediaUpstreamTarget;
}

interface MediaHttpRequest {
  method: 'GET' | 'POST';
  body?: string;
  headers: Record<string, string>;
}

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
    const { answer, firstReply } = await this.exchangeCapturingFirstReply(
      { ...call, failureReasonOf },
      (exchange) => call.protocol.generate(call.request, call.target, exchange),
    );
    if (!firstReply) {
      throw new UpstreamProtocolError('The media protocol answered without calling the upstream');
    }
    return { ...answer, ...firstReply };
  }

  async exchange<Answer>(
    connection: MediaConnection,
    use: (exchange: MediaExchange) => Promise<Answer>,
  ): Promise<Answer> {
    const { answer } = await this.exchangeCapturingFirstReply(connection, use);
    return answer;
  }

  private async exchangeCapturingFirstReply<Answer>(
    connection: MediaConnection,
    use: (exchange: MediaExchange) => Promise<Answer>,
  ): Promise<{ answer: Answer; firstReply: UpstreamReply | null }> {
    const deadlines = new AttemptDeadlines(connection.timeouts, connection.clientSignal);
    deadlines.start('totalMs');
    let firstReply: UpstreamReply | null = null;
    const sendCapturingFirstReply = async (
      url: string,
      request: MediaHttpRequest,
    ): Promise<unknown> => {
      const { body, ...reply } = await this.send(connection, url, deadlines.signal, request);
      firstReply ??= reply;
      return body;
    };
    try {
      const answer = await use({
        postJson: (url, body, headers = {}) =>
          sendCapturingFirstReply(url, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json', ...headers },
          }),
        getJson: (url) => sendCapturingFirstReply(url, { method: 'GET', headers: {} }),
        fetchMedia: (url) => this.fetcher.fetch(url, deadlines.signal),
      });
      return { answer, firstReply };
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
    request: MediaHttpRequest,
  ): Promise<UpstreamReply & { body: unknown }> {
    const response = await this.http.request<Response>(url, {
      method: request.method,
      body: request.body,
      headers: {
        'user-agent': GATEWAY_USER_AGENT,
        ...request.headers,
        ...connection.authHeaders,
      },
      responseType: 'response',
      signal,
      retry: false,
      throwOnHttpError: false,
      redirect: 'error',
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
      return {
        body: JSON.parse(text),
        upstreamStatus: response.status,
        upstreamRequestId: upstreamRequestIdOf(headers),
      };
    } catch (error) {
      throw new UpstreamProtocolError('The upstream answered with a body that is not JSON', {
        cause: error,
      });
    }
  }
}
