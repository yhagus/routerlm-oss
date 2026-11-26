import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference";
import type { ClientConnection } from "@/libs/models/client-connection";
import type { User } from "@/users/models/user";
import type { PlaygroundTranscription } from "@/playground/models/playground-transcription";

export class SendPlaygroundTranscriptionCommand extends Command<PlaygroundTranscription> {
  constructor(
    readonly body: unknown,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
