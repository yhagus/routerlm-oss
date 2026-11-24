import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundRequest } from "@/playground/schemas/playground.schema.js";

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
