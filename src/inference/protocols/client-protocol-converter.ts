import type { ClientProtocol } from "@/db/schemas/index.js";
import { GatewayError } from "../models/gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../models/internal-format.js";

/** What a response says about itself; every id and name in it is ours. */
export interface ResponseContext {
  /** Our id for the request; the converter shapes it like the Protocol's ids (`chatcmpl-<id>`). */
  requestId: string;
  /** Our Model name, never the Upstream Model id. */
  modelName: string;
  createdAt: Date;
}

/**
 * Translates between one client Protocol and the internal format (ADR 0002).
 * Converters are pure: no I/O, no Nest dependencies. Register a new one in
 * `CLIENT_PROTOCOL_CONVERTERS` (converters.ts).
 */
export interface ClientProtocolConverter {
  readonly protocol: ClientProtocol;

  /**
   * Parses a request body. Unknown fields are dropped. Throws a GatewayError
   * `invalid_request` for a malformed body or an out-of-scope feature, naming it.
   */
  parseRequest(body: unknown): InferenceRequest;

  /** The JSON body of a non-streaming response. */
  writeResponse(
    response: InferenceResponse,
    request: InferenceRequest,
    context: ResponseContext,
  ): unknown;

  /**
   * The bytes of a streaming response, as server-sent-event text. Errors from
   * `events` propagate: `writeClientStream` turns a GatewayError into the
   * Protocol's error event with `writeStreamError`.
   * @deprecated Kept until the relay loop drives `startStream` itself; implement it
   * as `(events, request, context) => writeStreamWith(startStream(request, context), events)`.
   */
  writeStream(
    events: AsyncIterable<InferenceStreamEvent>,
    request: InferenceRequest,
    context: ResponseContext,
  ): AsyncIterable<string>;

  /** A writer for one streaming response, fed one internal event at a time. */
  startStream(request: InferenceRequest, context: ResponseContext): ClientStreamWriter;

  /** The JSON body of an error response, in the Protocol's envelope. */
  writeError(error: GatewayError): unknown;

  /**
   * The last server-sent-event text of a stream that failed after its first
   * chunk reached the client (spec "Fallback": no Fallback then, the HTTP
   * status is already sent). Nothing follows it, so no end marker either.
   */
  writeStreamError(error: GatewayError): string;
}

/**
 * Writes one streaming response in the client Protocol, one internal event at
 * a time, with no async work of its own: whatever the Protocol holds back
 * until the end (stop reason, usage, open blocks) lives in the writer. Each
 * method returns server-sent-event text, possibly several events joined, or
 * "" when it has nothing to send yet.
 */
export interface ClientStreamWriter {
  /** What the Protocol sends before the first event (`message_start`, the role chunk). */
  start(): string;
  /** What one internal event becomes. */
  write(event: InferenceStreamEvent): string;
  /** What closes a stream that ended normally (held usage, the end marker). */
  end(): string;
}

/** `writer`'s output for `events`, as the deprecated `writeStream` returns it. */
export async function* writeStreamWith(
  writer: ClientStreamWriter,
  events: AsyncIterable<InferenceStreamEvent>,
): AsyncIterable<string> {
  const opening = writer.start();
  if (opening !== "") {
    yield opening;
  }
  for await (const event of events) {
    const written = writer.write(event);
    if (written !== "") {
      yield written;
    }
  }
  const closing = writer.end();
  if (closing !== "") {
    yield closing;
  }
}

/**
 * A streaming response in the client Protocol: `converter.writeStream`, ended
 * by the Protocol's error event when `events` throws a GatewayError midway.
 */
export async function* writeClientStream(
  converter: ClientProtocolConverter,
  events: AsyncIterable<InferenceStreamEvent>,
  request: InferenceRequest,
  context: ResponseContext,
): AsyncIterable<string> {
  try {
    yield* converter.writeStream(events, request, context);
  } catch (error) {
    if (!(error instanceof GatewayError)) {
      throw error;
    }
    yield converter.writeStreamError(error);
  }
}
