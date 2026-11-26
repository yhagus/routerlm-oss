import type {
  AttemptFailureReason,
  ClientProtocol,
  ParameterPolicy,
  UpstreamProtocol,
} from '@/db/schemas';
import type { SnapshotUpstreamModel } from '@/snapshot/models/snapshot';
import type { MediaUnits } from '@/usage/models/usage-job';
import type { GatewayError } from './gateway-error';
import type { InferenceCaller } from './inference';

export interface MediaRequest {
  model: string;
}

export interface FetchedMedia {
  bytes: Uint8Array;
  contentType: string;
}

export interface MediaResponseContext {
  modelName: string;
  createdAt: Date;
  caller: InferenceCaller;
  servedBy: { providerAccountId: string; upstreamModelRowId: string };
}

export interface MediaReply {
  contentType: string;
  body: Uint8Array;
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const encoder = new TextEncoder();

export function jsonReply(json: unknown): MediaReply {
  return { contentType: JSON_CONTENT_TYPE, body: encoder.encode(JSON.stringify(json)) };
}

export interface MediaUpstreamTarget {
  baseUrl: string;
  upstreamModelId: string;
  isWatermarked: boolean;
}

export interface MediaExchange {
  postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;
  getJson(url: string): Promise<unknown>;
  fetchMedia(url: string): Promise<FetchedMedia>;
}

export interface MediaOutcome<Result> {
  result: Result;
  units: MediaUnits;
}

export interface MediaUpstreamProtocol<Request, Result> {
  readonly protocol: UpstreamProtocol;
  failureReasonOf(status: number, body: string): AttemptFailureReason;
  generate(
    request: Request,
    target: MediaUpstreamTarget,
    exchange: MediaExchange,
  ): Promise<MediaOutcome<Result>>;
}

export interface MediaClientContract<Request extends MediaRequest, Result> {
  readonly protocol: ClientProtocol;
  parseRequest(body: unknown): Request;
  unservableReason(upstreamModel: SnapshotUpstreamModel, request: Request): string | null;
  readonly upstreamProtocols: Partial<
    Record<UpstreamProtocol, MediaUpstreamProtocol<Request, Result>>
  >;
  applyParameterPolicy?(request: Request, policy: ParameterPolicy): Request;
  writeResponse(result: Result, context: MediaResponseContext): MediaReply;
  writeError(error: GatewayError): unknown;
}
