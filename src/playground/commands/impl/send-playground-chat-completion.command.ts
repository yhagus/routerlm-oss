import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundRequest } from "../../schemas/playground.schema.js";

/**
 * Sends a User's Playground request through the same inference path as a
 * client request, in the Chat Completions wire format, and returns the event
 * stream followed by a summary event. Keeps no conversation: the browser
 * sends all of it every time.
 */
export class SendPlaygroundChatCompletionCommand extends Command<AsyncIterable<string>> {
  constructor(
    readonly body: PlaygroundRequest,
    readonly user: User,
    readonly connection: ClientConnection,
  ) {
    super();
  }
}
