import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundSpeech } from "@/playground/models/playground-speech.js";

export class SendPlaygroundSpeechCommand extends Command<PlaygroundSpeech> {
  constructor(
    readonly body: unknown,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
