import { Command } from "@nestjs/cqrs";
import type {
  ImageGenerationRequest,
  GeneratedImages,
} from "@/inference/models/image-generation.js";
import type { InferenceTarget } from "@/inference/models/inference.js";
import type { MediaClientContract } from "@/inference/models/media-kind.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { PlaygroundImageGeneration } from "@/playground/models/playground-image-generation.js";

export class SendPlaygroundImageGenerationCommand extends Command<PlaygroundImageGeneration> {
  constructor(
    readonly contract: MediaClientContract<ImageGenerationRequest, GeneratedImages>,
    readonly body: unknown,
    readonly user: User,
    readonly connection: ClientConnection,
    readonly target: InferenceTarget,
  ) {
    super();
  }
}
