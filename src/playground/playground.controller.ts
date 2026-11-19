import type { IncomingMessage, ServerResponse } from "node:http";
import { CurrentUser } from "@nestjs/authentication";
import { Body, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseFilters } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { clientConnectionOf } from "@/libs/models/client-connection.js";
import { eventStreamResponse } from "@/libs/models/event-stream-response.js";
import type { User } from "@/users/models/user.js";
import { PlaygroundExceptionFilter } from "./filters/playground-exception.filter.js";
import { type PlaygroundRequest, playgroundRequestSchema } from "./schemas/playground.schema.js";
import { SendPlaygroundChatCompletionCommand } from "./commands/impl/send-playground-chat-completion.command.js";
import { SendPlaygroundImageGenerationCommand } from "./commands/impl/send-playground-image-generation.command.js";
import type { PlaygroundImageGeneration } from "./models/playground-image-generation.js";

/** The Playground's endpoints: a signed-in User's session, never an API Key. */
@DashboardController("playground")
@UseFilters(PlaygroundExceptionFilter)
export class PlaygroundController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("chat/completions")
  @HttpCode(200)
  async sendChatCompletion(
    @Body({ schema: playgroundRequestSchema }) body: PlaygroundRequest,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    const chunks = await this.commandBus.execute(
      new SendPlaygroundChatCompletionCommand(body, user, clientConnectionOf(request, response), {
        kind: "named-model",
      }),
    );
    return eventStreamResponse(chunks);
  }

  /** A direct Upstream Model test: no Model, so the body's `model` is not resolved. */
  @Post("upstream-models/:upstreamModelId/chat/completions")
  @HttpCode(200)
  async sendChatCompletionToUpstreamModel(
    @Param("upstreamModelId", ParseUUIDPipe) upstreamModelId: string,
    @Body({ schema: playgroundRequestSchema }) body: PlaygroundRequest,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    const chunks = await this.commandBus.execute(
      new SendPlaygroundChatCompletionCommand(body, user, clientConnectionOf(request, response), {
        kind: "upstream-model",
        upstreamModelId,
      }),
    );
    return eventStreamResponse(chunks);
  }

  /** An image request as a client sends it to `/v1/images/generations`; the answer adds a summary. */
  @Post("images/generations")
  @HttpCode(200)
  generateImage(
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(body, user, clientConnectionOf(request, response), {
        kind: "named-model",
      }),
    );
  }

  /** A direct Upstream Model test of image generation: the body's `model` is not resolved. */
  @Post("upstream-models/:upstreamModelId/images/generations")
  @HttpCode(200)
  generateImageWithUpstreamModel(
    @Param("upstreamModelId", ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(body, user, clientConnectionOf(request, response), {
        kind: "upstream-model",
        upstreamModelId,
      }),
    );
  }
}
