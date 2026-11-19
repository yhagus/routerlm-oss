import type { AttemptFailureReason, ClientProtocol, UpstreamProtocol } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { MediaUnits } from "@/usage/models/usage-job.js";
import type { GatewayError } from "./gateway-error.js";

// The seam every media Kind plugs into (spec "Kind-aware inference pipeline").
// A Kind brings a client contract, which reads the OpenAI-shaped request into
// the Kind's own internal request and writes its internal result back, and
// one upstream Protocol per Provider API that serves the Kind. The Attempt and
// Fallback loop, the Usage Log and the media fetcher are shared
// (RunMediaInferenceHandler); adding a Kind touches none of them, nor chat.

/** What every media request names: the Model, or for a direct test, the Upstream Model's id. */
export interface MediaRequest {
  model: string;
}

/** A file an upstream generated, as the media fetcher downloaded it. Held in memory only (ADR 0004). */
export interface FetchedMedia {
  bytes: Uint8Array;
  contentType: string;
}

/** What a response says about itself; every name in it is ours. */
export interface MediaResponseContext {
  /** Our Model name, never the Upstream Model id. */
  modelName: string;
  createdAt: Date;
}

/** Which Upstream Model, at which endpoint, an Attempt calls. */
export interface MediaUpstreamTarget {
  /** The Provider endpoint's base URL for the Kind; the Protocol appends its own path. */
  baseUrl: string;
  /** The model name as the Provider spells it. */
  upstreamModelId: string;
  /**
   * Whether the Provider marks what it generates. Off unless the Route's
   * Parameter Policy turns it on (spec "DashScope Protocols").
   */
  isWatermarked: boolean;
}

/**
 * The I/O one Attempt may do, so a Protocol stays free of Nest and HTTP. The
 * Attempt's credential and deadline apply to every call; each throws
 * AttemptFailedError (or ClientCancelledError) when it fails.
 */
export interface MediaExchange {
  /** POSTs `body` as JSON with the Provider Account's credential; resolves to the parsed 2xx body. */
  postJson(url: string, body: unknown): Promise<unknown>;
  /** Downloads a file the upstream generated, without the credential (ADR 0028). */
  fetchMedia(url: string): Promise<FetchedMedia>;
}

/** What an Attempt produced, and the units its Usage Log counts. */
export interface MediaOutcome<Result> {
  result: Result;
  units: MediaUnits;
}

/** One upstream Protocol of a media Kind (ADR 0002, once per Kind). */
export interface MediaUpstreamProtocol<Request, Result> {
  readonly protocol: UpstreamProtocol;
  /** The Fallback reason of a non-2xx answer, from its status and body (the Provider's error code). */
  failureReasonOf(status: number, body: string): AttemptFailureReason;
  /** Makes the request upstream and reads the answer into the Kind's result. */
  generate(
    request: Request,
    target: MediaUpstreamTarget,
    exchange: MediaExchange,
  ): Promise<MediaOutcome<Result>>;
}

/** The client side of one media Kind: its OpenAI-shaped endpoint. */
export interface MediaClientContract<Request extends MediaRequest, Result> {
  readonly protocol: ClientProtocol;
  /**
   * Reads a request body. Throws a GatewayError `invalid_request` for a
   * malformed body or an unsupported feature, naming it.
   */
  parseRequest(body: unknown): Request;
  /**
   * Why the Upstream Model can't serve the request (a limit it doesn't meet),
   * or null when it can. A Route it names is skipped; when no Route is left,
   * the first reason is the client's 400.
   */
  unservableReason(upstreamModel: SnapshotUpstreamModel, request: Request): string | null;
  /** The upstream Protocols that serve this Kind; a Route whose endpoint speaks another is skipped. */
  readonly upstreamProtocols: Partial<
    Record<UpstreamProtocol, MediaUpstreamProtocol<Request, Result>>
  >;
  /** The JSON body of a successful response. */
  writeResponse(result: Result, context: MediaResponseContext): unknown;
  /** The JSON body of an error response, in the endpoint's envelope. */
  writeError(error: GatewayError): unknown;
}
