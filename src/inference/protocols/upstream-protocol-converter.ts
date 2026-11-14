import type { ProviderQuirks, UpstreamProtocol } from "@/db/schemas/index.js";
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from "../models/internal-format.js";

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

  /** Parses a successful (2xx) streaming body. Throws if it isn't the Protocol's shape. */
  parseStream(body: AsyncIterable<Uint8Array>): AsyncIterable<InferenceStreamEvent>;
}
