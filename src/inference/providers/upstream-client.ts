import { Injectable } from '@nestjs/common';
import { HttpClient, type HttpResponse } from '@nestjs/http-client';
import type { AttemptFailureReason } from '@/db/schemas';
import { GATEWAY_USER_AGENT } from '@/libs/models/gateway-version';
import { AttemptFailedError, ClientCancelledError } from '@/inference/models/attempt-failure';
import { carriesProviderErrorCode } from '@/inference/models/quota-exhausted-error';
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from '@/inference/models/internal-format';
import {
  parseUpstreamStream,
  type UpstreamHttpRequest,
  type UpstreamProtocolConverter,
  UpstreamProtocolError,
  type UpstreamStreamParser,
  type UpstreamTarget,
} from '@/inference/protocols/upstream-protocol-converter';
import type { Destination } from '@/inference/models/destination';
import type { SnapshotRoute } from '@/snapshot/models/snapshot';
import { upstreamRequestIdOf } from '@/inference/models/upstream-request-id';
import { gatherStream } from '@/inference/protocols/gather-stream';
import {
  type ServerSentEvent,
  ServerSentEventDecoder,
} from '@/inference/protocols/server-sent-events';

export const DEFAULT_TIMEOUTS: AttemptTimeouts = {
  connectMs: 10_000,
  firstTokenMs: 60_000,
  totalMs: 600_000,
};

export function totalTimeoutMsOf(destination: Destination, route: SnapshotRoute | null): number {
  if (destination.kind === 'probe') {
    return destination.totalTimeoutMs;
  }
  return route?.totalTimeoutMs ?? DEFAULT_TIMEOUTS.totalMs;
}

export interface AttemptTimeouts {
  connectMs: number;
  firstTokenMs: number;
  totalMs: number;
}

export interface UpstreamCall {
  converter: UpstreamProtocolConverter;
  request: InferenceRequest;
  target: UpstreamTarget;
  authHeaders: Record<string, string>;
  forwardedHeaders: Record<string, string>;
  timeouts: AttemptTimeouts;
  clientSignal: AbortSignal;
}

export interface CompletedAttempt {
  response: InferenceResponse;
  upstreamStatus: number;
  upstreamRequestId: string | null;
}

type Deadline = keyof AttemptTimeouts;

class DeadlineExceeded extends Error {
  constructor(readonly deadline: Deadline) {
    super(`Upstream deadline exceeded: ${deadline}`);
  }
}

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
    clientSignal.addEventListener('abort', this.onClientAbort, { once: true });
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

  finish(): void {
    for (const deadline of this.timers.keys()) {
      this.stop(deadline);
    }
    this.clientSignal.removeEventListener('abort', this.onClientAbort);
    this.controller.abort(new ClientCancelledError());
  }

  failureOf(error: unknown, whileStreaming: boolean): Error {
    const reason: unknown = this.signal.aborted ? this.signal.reason : undefined;
    if (reason instanceof ClientCancelledError) {
      return reason;
    }
    if (reason instanceof DeadlineExceeded) {
      return new AttemptFailedError('timeout', null, reason.message, null, { cause: error });
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

function failureReasonOfThrown(error: unknown, whileStreaming: boolean): AttemptFailureReason {
  if (whileStreaming) return 'stream_interrupted';
  if (error instanceof UpstreamProtocolError) return 'server_error';
  return 'connection_error';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class UpstreamEventReader {
  private readonly decoder = new ServerSentEventDecoder();
  private isEnded = false;
  private deferredFailure: { error: unknown } | null = null;

  constructor(
    private readonly body: ReadableStreamDefaultReader<Uint8Array>,
    private readonly parser: UpstreamStreamParser,
  ) {}

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

  private failAfter(events: InferenceStreamEvent[], error: unknown): void {
    if (events.length === 0) {
      throw error;
    }
    this.deferredFailure = { error };
    this.isEnded = true;
  }
}

export class UpstreamStream {
  constructor(
    private firstBatch: InferenceStreamEvent[] | null,
    private readonly events: UpstreamEventReader,
    private readonly deadlines: AttemptDeadlines,
    readonly upstreamStatus: number,
    readonly upstreamRequestId: string | null,
  ) {}

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
      const failure = this.deadlines.failureOf(error, true);
      this.close();
      throw failure;
    }
  }

  close(): void {
    this.deadlines.finish();
  }
}

@Injectable()
export class UpstreamClient {
  constructor(private readonly http: HttpClient) {}

  async complete(call: UpstreamCall): Promise<CompletedAttempt> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start('totalMs');
    try {
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      const headers = Object.fromEntries(response.headers.entries());
      const upstreamRequestId = upstreamRequestIdOf(headers);
      if (written.isAnsweredAsStream) {
        const gathered = await gatherStream(
          parseUpstreamStream(() => call.converter.startStream(), streamBodyOf(response)),
        );
        return { response: gathered, upstreamStatus: response.status, upstreamRequestId };
      }
      const body = await response.data.text();
      if (carriesProviderErrorCode(body, call.target.quirks.exhaustedErrorCodes ?? [])) {
        throw new AttemptFailedError(
          'exhausted',
          response.status,
          `The upstream answered ${response.status} with an Exhausted error code`,
          { headers, body },
        );
      }
      return {
        response: call.converter.parseResponse(parseJsonBody(body)),
        upstreamStatus: response.status,
        upstreamRequestId,
      };
    } catch (error) {
      throw deadlines.failureOf(error, false);
    } finally {
      deadlines.finish();
    }
  }

  async openStream(call: UpstreamCall): Promise<UpstreamStream> {
    const deadlines = new AttemptDeadlines(call.timeouts, call.clientSignal);
    deadlines.start('totalMs');
    try {
      deadlines.start('connectMs');
      const written = call.converter.writeRequest(call.request, call.target);
      const response = await this.send(call, written, deadlines.signal);
      deadlines.stop('connectMs');
      const events = new UpstreamEventReader(
        streamBodyOf(response).getReader(),
        call.converter.startStream(),
      );
      deadlines.start('firstTokenMs');
      const firstBatch = await events.nextBatch();
      deadlines.stop('firstTokenMs');
      return new UpstreamStream(
        firstBatch,
        events,
        deadlines,
        response.status,
        upstreamRequestIdOf(Object.fromEntries(response.headers.entries())),
      );
    } catch (error) {
      const failure = deadlines.failureOf(error, false);
      deadlines.finish();
      throw failure;
    }
  }

  private async send(
    call: UpstreamCall,
    written: UpstreamHttpRequest,
    signal: AbortSignal,
  ): Promise<HttpResponse<Response>> {
    const response = await this.http.post<Response>(written.url, {
      body: written.body,
      headers: {
        'user-agent': GATEWAY_USER_AGENT,
        ...call.forwardedHeaders,
        ...written.headers,
        ...call.target.quirks.fixedHeaders,
        ...call.authHeaders,
      },
      responseType: 'response',
      signal,
      retry: false,
      throwOnHttpError: false,
      redirect: 'error',
    });
    if (!response.ok) {
      throw await failedResponse(response, call.target);
    }
    return response;
  }
}

function streamBodyOf(response: HttpResponse<Response>): ReadableStream<Uint8Array> {
  const body = response.data.body;
  if (!body) {
    throw new UpstreamProtocolError('The upstream stream has no body');
  }
  return body;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UpstreamProtocolError('The upstream answered with a body that is not JSON', {
      cause: error,
    });
  }
}

async function failedResponse(
  response: HttpResponse<Response>,
  target: UpstreamTarget,
): Promise<AttemptFailedError> {
  const upstreamResponse = {
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.data.text(),
  };
  return new AttemptFailedError(
    failureReasonOf(response.status, upstreamResponse.body, target),
    response.status,
    `The upstream answered ${response.status}`,
    upstreamResponse,
  );
}

function failureReasonOf(
  status: number,
  body: string,
  { quirks }: UpstreamTarget,
): AttemptFailureReason {
  if (carriesProviderErrorCode(body, quirks.exhaustedErrorCodes ?? [])) {
    return 'exhausted';
  }
  if (carriesProviderErrorCode(body, quirks.notInPlanErrorCodes ?? [])) {
    return 'not_in_plan';
  }
  return failureReasonOfStatus(status);
}

export function failureReasonOfStatus(status: number): AttemptFailureReason {
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status >= 500) {
    return 'server_error';
  }
  return 'bad_request';
}
