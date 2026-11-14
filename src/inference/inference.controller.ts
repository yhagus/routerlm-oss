import type { IncomingMessage, ServerResponse } from "node:http";
import { Authenticate, CurrentUser } from "@nestjs/authentication";
import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import { clientConnectionOf } from "@/libs/models/client-connection.js";
import { eventStreamResponse } from "@/libs/models/event-stream-response.js";
import type { ClientModelList } from "./models/client-model.js";
import { RunInferenceCommand } from "./commands/impl/run-inference.command.js";
import { ListClientModelsQuery } from "./queries/impl/list-client-models.query.js";
import { anthropicMessagesClientConverter } from "./protocols/anthropic-messages/anthropic-messages-client-converter.js";
import { openAiChatClientConverter } from "./protocols/openai-chat/openai-chat-client-converter.js";
import { openAiResponsesClientConverter } from "./protocols/openai-responses/openai-responses-client-converter.js";

/** Where client applications call the gateway. */
export const INFERENCE_API_PREFIX = "v1";

/**
 * The client-facing inference API. Only API Keys sign in here; because of
 * that restriction, `@CurrentUser()` is always an ApiKeyPrincipal on these routes.
 */
@Controller(INFERENCE_API_PREFIX)
@Authenticate({ providers: [ApiKeyAuth] })
export class InferenceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("chat/completions")
  @HttpCode(200)
  async createChatCompletion(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiChatClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return result.kind === "response" ? result.body : eventStreamResponse(result.chunks);
  }

  @Post("messages")
  @HttpCode(200)
  async createMessage(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        anthropicMessagesClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return result.kind === "response" ? result.body : eventStreamResponse(result.chunks);
  }

  @Post("responses")
  @HttpCode(200)
  async createResponse(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiResponsesClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return result.kind === "response" ? result.body : eventStreamResponse(result.chunks);
  }

  @Get("models")
  listModels(@CurrentUser() principal: ApiKeyPrincipal): Promise<ClientModelList> {
    return this.queryBus.execute(new ListClientModelsQuery(principal));
  }
}
