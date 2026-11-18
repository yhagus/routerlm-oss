import type { ProviderQuirks, UpstreamProtocol } from "@/db/schemas/index.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../models/internal-format.js";
import { type ServerSentEvent, ServerSentEventDecoder } from "./server-sent-events.js";

/**
 * An upstream answered in a shape its Protocol doesn't allow, or reported an
 * error inside a stream. The message may quote upstream text: log it, never
 * send it to the client.
 */
export class UpstreamProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UpstreamProtocolError";
  }
}

/** Which Upstream Model, at which Provider, a request is written for. */
export interface UpstreamTarget {
  /** The Provider's base URL; the Protocol appends its own path. */
  baseUrl: string;
  /** The model name as the Provider spells it. */
  upstreamModelId: string;
  quirks: ProviderQuirks;
  /** The Upstream Model's output limit, for Protocols that require one on every request. */
  maxOutputTokens?: number;
  /** Sent only where the Provider's quirks accept a prompt cache key. */
  promptCacheKey?: string;
  /**
   * The Service Tier as the Provider spells it, sent as `service_tier`. Unset
   * when the request asks for none or the Upstream Model doesn't accept it.
   */
  serviceTierValue?: string;
}

/**
 * An HTTP request ready to send, minus the Provider Account's credentials:
 * the caller adds those (see `upstreamAuthHeaders`), so a converter never sees a key.
 */
export interface UpstreamHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** JSON text. The same input always gives byte-identical output, so upstream prompt caches hit. */
  body: string;
  /**
   * Set when the upstream will answer a non-streaming request as a stream (a
   * Provider that only streams): the caller gathers the stream into one response.
   */
  isAnsweredAsStream?: boolean;
}

/**
 * Translates between the internal format (ADR 0002) and one upstream
 * Protocol. Converters are pure: no I/O, no Nest dependencies. Register a new
 * one in `UPSTREAM_PROTOCOL_CONVERTERS` (converters.ts).
 */
export interface UpstreamProtocolConverter {
  readonly protocol: UpstreamProtocol;

  /** Streams always ask the upstream to report usage. */
  writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest;

  /** Parses a successful (2xx) non-streaming JSON body. Throws if it isn't the Protocol's shape. */
  parseResponse(body: unknown): InferenceResponse;

  /**
   * Parses a successful (2xx) streaming body. Throws if it isn't the Protocol's shape.
   * @deprecated Kept until the relay loop drives `startStream` itself; implement it
   * as `(body) => parseUpstreamStream(startStream, body)`.
   */
  parseStream(body: AsyncIterable<Uint8Array>): AsyncIterable<InferenceStreamEvent>;

  /** A parser for one successful (2xx) streaming body, fed one server-sent event at a time. */
  startStream(): UpstreamStreamParser;
}

/**
 * Reads one upstream stream, one server-sent event at a time, with no async
 * work of its own: whatever state the Protocol needs between events (open
 * blocks, tool-call numbering, usage so far) lives in the parser.
 */
export interface UpstreamStreamParser {
  /**
   * The internal events one server-sent event carries, in order: often one,
   * sometimes none (a ping, an event type the reader ignores), sometimes
   * several. Throws UpstreamProtocolError for an event that isn't the
   * Protocol's shape or that reports an error mid-stream.
   */
  parse(event: ServerSentEvent): InferenceStreamEvent[];

  /**
   * True once the Protocol's end marker arrived (`[DONE]`, `message_stop`).
   * The caller stops reading then; whatever follows is ignored.
   */
  readonly isDone: boolean;

  /**
   * Called when the body ends before `isDone`. Returns any last events, or
   * throws UpstreamProtocolError when the Protocol requires an end marker.
   */
  end(): InferenceStreamEvent[];
}

/** The stream `startStream` parses, as an async iterable, for callers that gather or iterate it. */
export async function* parseUpstreamStream(
  startStream: () => UpstreamStreamParser,
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<InferenceStreamEvent> {
  const parser = startStream();
  const decoder = new ServerSentEventDecoder();
  for await (const chunk of body) {
    for (const event of decoder.push(chunk)) {
      yield* parser.parse(event);
      if (parser.isDone) {
        return;
      }
    }
  }
  for (const event of decoder.end()) {
    yield* parser.parse(event);
    if (parser.isDone) {
      return;
    }
  }
  yield* parser.end();
}
