import type { IncomingMessage } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { ClientProtocol } from '@/db/schemas';
import { UsageProducer } from '@/usage/jobs/usage.producer';
import { ClientCancelledError } from '@/inference/models/attempt-failure';
import { requestBytesOf, requestSenderOf } from '@/libs/models/client-connection';
import { GatewayError } from '@/inference/models/gateway-error';
import { CLIENT_PROTOCOL_CONVERTERS } from '@/inference/protocols/converters';
import { openAiChatClientConverter } from '@/inference/protocols/openai-chat/openai-chat-client-converter';
import { UsageMeter } from '@/inference/models/usage-meter';

const INFERENCE_PATH_PREFIX = '/v1/';
const MULTIPART_CONTENT_TYPE = 'multipart/form-data';

@Catch()
export class InferenceExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(UsageProducer) private readonly usage: UsageProducer,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof ClientCancelledError) {
      return;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<IncomingMessage>();
    const path = request.url ?? '';
    const error =
      host.getType() === 'http' && path.startsWith(INFERENCE_PATH_PREFIX)
        ? gatewayErrorOf(exception, request)
        : null;
    const { httpAdapter } = this.adapterHost;
    if (!error) {
      new BaseExceptionFilter(httpAdapter).catch(exception, host);
      return;
    }
    const protocol = clientProtocolOf(path);
    const converter = CLIENT_PROTOCOL_CONVERTERS[protocol] ?? openAiChatClientConverter;
    const envelope = converter.writeError(error);
    if (!(exception instanceof GatewayError) && request.method === 'POST') {
      const meter = new UsageMeter(
        { kind: 'unidentified' },
        protocol,
        requestBytesOf(request),
        requestSenderOf(request),
      );
      this.usage.enqueue(meter.finishWithError(error, envelope));
    }
    httpAdapter.reply(http.getResponse(), envelope, error.status);
  }
}

function gatewayErrorOf(exception: unknown, request: IncomingMessage): GatewayError | null {
  if (exception instanceof GatewayError) {
    return exception;
  }
  if (!(exception instanceof HttpException)) {
    return null;
  }
  switch (exception.getStatus()) {
    case 400:
      return new GatewayError(
        'invalid_request',
        isMultipart(request)
          ? 'The request body could not be read as a multipart form'
          : 'The request body could not be read as JSON',
        'client',
      );
    case 401:
      return new GatewayError(
        'invalid_api_key',
        'Missing, invalid, revoked or expired API Key',
        'client',
      );
    case 413:
      return new GatewayError(
        'request_too_large',
        'The request body is over the size limit',
        'client',
      );
    default:
      return null;
  }
}

function isMultipart(request: IncomingMessage): boolean {
  return request.headers['content-type']?.toLowerCase().startsWith(MULTIPART_CONTENT_TYPE) ?? false;
}

function clientProtocolOf(path: string): ClientProtocol {
  if (path.startsWith('/v1/messages')) {
    return 'anthropic-messages';
  }
  if (path.startsWith('/v1/responses')) {
    return 'openai-responses';
  }
  if (path.startsWith('/v1/images')) {
    return 'openai-images';
  }
  if (path.startsWith('/v1/videos')) {
    return 'openai-videos';
  }
  if (path.startsWith('/v1/audio/speech')) {
    return 'openai-speech';
  }
  if (path.startsWith('/v1/audio/transcriptions')) {
    return 'openai-transcription';
  }
  return 'openai-chat';
}
