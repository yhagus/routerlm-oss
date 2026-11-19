import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundTranscription } from "../../models/playground-transcription.js";

/**
 * Sends a User's Playground transcription request through the same inference
 * path as a client's `POST /v1/audio/transcriptions`, and returns the
 * transcript with a summary. Nothing is stored (ADR 0004). `body` is the form
 * with its upload read in; `target` is the Model the body names, or one
 * Upstream Model for a direct Upstream Model test.
 */
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
