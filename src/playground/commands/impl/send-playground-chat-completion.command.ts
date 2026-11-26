import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference";
import type { ClientConnection } from "@/libs/models/client-connection";
import type { User } from "@/users/models/user";
import type { PlaygroundRequest } from "@/playground/schemas/playground.schema";

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
