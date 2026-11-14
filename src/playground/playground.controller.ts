import type { IncomingMessage, ServerResponse } from "node:http";
import { CurrentUser } from "@nestjs/authentication";
import { Body, HttpCode, Post, Req, Res, UseFilters } from "@nestjs/common";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import { clientConnectionOf } from "../inference/client-connection.js";
import { eventStreamResponse } from "../inference/event-stream-response.js";
import type { User } from "../users/user.js";
import { PlaygroundExceptionFilter } from "./playground-exception.filter.js";
import { type PlaygroundRequest, playgroundRequestSchema } from "./playground.schemas.js";
import { PlaygroundService } from "./playground.service.js";

/** The Playground's endpoint: a signed-in User's session, never an API Key. */
@DashboardController("playground")
@UseFilters(PlaygroundExceptionFilter)
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Post("chat/completions")
  @HttpCode(200)
  async sendChatCompletion(
    @Body({ schema: playgroundRequestSchema }) body: PlaygroundRequest,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    const chunks = await this.playground.sendChatCompletion(
      body,
      user,
      clientConnectionOf(request, response),
    );
    return eventStreamResponse(chunks);
  }
}
