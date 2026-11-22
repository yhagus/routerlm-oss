import type { ClientProtocol } from "@/db/schemas/index.js";
import type { GatewayError } from "@/inference/models/gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "@/inference/models/internal-format.js";

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
