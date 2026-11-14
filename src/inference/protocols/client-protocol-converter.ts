import type { ClientProtocol } from "../../db/schema.js";
import type { GatewayError } from "../gateway-error.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../internal-format.js";

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
   * The bytes of a streaming response, as server-sent-event text. If `events`
   * throws a GatewayError midway, the stream ends with the Protocol's error event
   * instead of rethrowing (the HTTP status is already sent).
   */
  writeStream(
    events: AsyncIterable<InferenceStreamEvent>,
    request: InferenceRequest,
    context: ResponseContext,
  ): AsyncIterable<string>;

  /** The JSON body of an error response, in the Protocol's envelope. */
  writeError(error: GatewayError): unknown;
}
