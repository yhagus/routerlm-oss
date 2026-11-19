import { Command } from "@nestjs/cqrs";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundImageGeneration } from "../../models/playground-image-generation.js";

/**
 * Sends a User's Playground image request through the same inference path
 * as a client's `POST /v1/images/generations`, and returns the response with
 * a summary. Nothing is stored (ADR 0004). `target` is the Model the body
 * names, or one Upstream Model for a direct Upstream Model test.
 */
export class SendPlaygroundImageGenerationCommand extends Command<PlaygroundImageGeneration> {
  constructor(
    readonly body: unknown,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
