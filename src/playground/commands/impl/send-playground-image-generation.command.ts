import { Command } from "@nestjs/cqrs";
import type { ImageGenerationRequest, GeneratedImages } from "@/inference/models/image-generation";
import type { InferenceTarget } from "@/inference/models/inference";
import type { MediaClientContract } from "@/inference/models/media-kind";
import type { ClientConnection } from "@/libs/models/client-connection";
import type { User } from "@/users/models/user";
import type { PlaygroundImageGeneration } from "@/playground/models/playground-image-generation";

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
