import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundRequest } from "../../schemas/playground.schema.js";

/**
 * Sends a User's Playground request through the same inference path as a
 * client request, in the Chat Completions wire format, and returns the event
 * stream followed by a summary event. Keeps no conversation: the browser
 * sends all of it every time. `target` is the Model the body names, or one
 * Upstream Model for a direct Upstream Model test.
 */
export class SendPlaygroundChatCompletionCommand extends Command<AsyncIterable<Uint8Array>> {
  constructor(
    readonly body: PlaygroundRequest,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
