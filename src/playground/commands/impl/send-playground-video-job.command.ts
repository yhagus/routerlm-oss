import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundVideoJob } from "@/playground/models/playground-video-job.js";

/**
 * Submits a User's Playground Video Job through the same path as a client's
 * `POST /v1/videos`, and returns the queued video with a summary. The User
 * then polls and downloads it by its id. `target` is the Model the body
 * names, or one Upstream Model for a direct Upstream Model test.
 */
export class SendPlaygroundVideoJobCommand extends Command<PlaygroundVideoJob> {
  constructor(
    readonly body: unknown,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
