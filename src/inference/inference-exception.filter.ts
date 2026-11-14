import type { IncomingMessage } from "node:http";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { ClientProtocol } from "../db/schema.js";
import { ClientCancelledError } from "./attempt-failure.js";
import { GatewayError } from "./gateway-error.js";
import { CLIENT_PROTOCOL_CONVERTERS } from "./protocols/converters.js";
import { openAiChatClientConverter } from "./protocols/openai-chat/openai-chat-client-converter.js";

const INFERENCE_PATH_PREFIX = "/v1/";

/**
 * Answers every error on `/v1/*` in the error contract (spec "Error
 * contract"), in the client Protocol's envelope. Registered globally because
 * some of these errors (a body over the size limit) happen before routing.
 * Other paths, and errors outside the contract (bugs), keep Nest's default handling.
 */
@Catch()
export class InferenceExceptionFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof ClientCancelledError) {
      return; // Nobody is left to answer.
    }
    const http = host.switchToHttp();
    const path = http.getRequest<IncomingMessage>().url ?? "";
    const error =
      host.getType() === "http" && path.startsWith(INFERENCE_PATH_PREFIX)
        ? gatewayErrorOf(exception)
        : null;
    // The adapter only exists once the app is created, after this filter is.
    const { httpAdapter } = this.adapterHost;
    if (!error) {
      new BaseExceptionFilter(httpAdapter).catch(exception, host);
      return;
    }
    const converter =
      CLIENT_PROTOCOL_CONVERTERS[clientProtocolOf(path)] ?? openAiChatClientConverter;
    httpAdapter.reply(http.getResponse(), converter.writeError(error), error.status);
  }
}

/** The error contract's view of an exception; null for anything it doesn't cover (a bug: 500). */
function gatewayErrorOf(exception: unknown): GatewayError | null {
  if (exception instanceof GatewayError) {
    return exception;
  }
  if (!(exception instanceof HttpException)) {
    return null;
  }
  switch (exception.getStatus()) {
    case 400:
      return new GatewayError("invalid_request", "The request body could not be read as JSON");
    case 401:
      return new GatewayError("invalid_api_key", "Missing, invalid, revoked or expired API Key");
    case 413:
      return new GatewayError("request_too_large", "The request body is over the size limit");
    default:
      return null;
  }
}

/** Which client Protocol a path speaks, so its errors use that Protocol's envelope. */
function clientProtocolOf(path: string): ClientProtocol {
  if (path.startsWith("/v1/messages")) {
    return "anthropic-messages";
  }
  if (path.startsWith("/v1/responses")) {
    return "openai-responses";
  }
  return "openai-chat";
}
