import type { ClientProtocol } from '@/db/schemas';
import type { GatewayError } from '@/inference/models/gateway-error';
import type {
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
} from '@/inference/models/internal-format';

export interface ResponseContext {
  requestId: string;
  modelName: string;
  createdAt: Date;
}

export interface ClientProtocolConverter {
  readonly protocol: ClientProtocol;

  parseRequest(body: unknown): InferenceRequest;

  writeResponse(
    response: InferenceResponse,
    request: InferenceRequest,
    context: ResponseContext,
  ): unknown;

  startStream(request: InferenceRequest, context: ResponseContext): ClientStreamWriter;

  writeError(error: GatewayError): unknown;

  writeStreamError(error: GatewayError): string;
}

export interface ClientStreamWriter {
  start(): string;
  write(event: InferenceStreamEvent): string;
  end(): string;
}
