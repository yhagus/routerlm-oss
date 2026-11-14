import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { GatewayError } from "../../inference/models/gateway-error.js";
import { openAiChatClientConverter } from "../../inference/protocols/openai-chat/openai-chat-client-converter.js";

/**
 * Answers the inference path's errors on the Playground with our error code
 * and message, in the Chat Completions envelope the Playground speaks.
 */
@Catch(GatewayError)
export class PlaygroundExceptionFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(error: GatewayError, host: ArgumentsHost): void {
    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      openAiChatClientConverter.writeError(error),
      error.status,
    );
  }
}
