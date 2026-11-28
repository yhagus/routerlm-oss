import type { StoredProviderQuirks } from '@/catalog/schemas/catalog.schema';
import type { UpstreamProtocol } from '@/db/schemas';
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from '@/inference/models/internal-format';
import type { SentParameters } from '@/usage/models/usage-job';
import { type ServerSentEvent, ServerSentEventDecoder } from './server-sent-events';

export class UpstreamProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UpstreamProtocolError';
  }
}

export interface UpstreamTarget {
  baseUrl: string;
  upstreamModelId: string;
  quirks: StoredProviderQuirks;
  maxOutputTokens?: number;
  promptCacheKey?: string;
  serviceTierValue?: string;
}

export interface UpstreamHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  sentParameters: SentParameters;
  isAnsweredAsStream?: boolean;
}

export interface UpstreamProtocolConverter {
  readonly protocol: UpstreamProtocol;

  writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest;

  parseResponse(body: unknown): InferenceResponse;

  startStream(): UpstreamStreamParser;
}

export interface UpstreamStreamParser {
  parse(event: ServerSentEvent): InferenceStreamEvent[];

  readonly isDone: boolean;

  end(): InferenceStreamEvent[];
}

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
