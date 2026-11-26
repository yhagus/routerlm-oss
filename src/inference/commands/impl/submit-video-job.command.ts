import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection";
import type { InferenceCaller, InferenceTarget, UsageListener } from "@/inference/models/inference";
import type { MediaReply } from "@/inference/models/media-kind";

export class SubmitVideoJobCommand extends Command<MediaReply> {
  constructor(
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: InferenceTarget = { kind: "named-model" },
  ) {
    super();
  }
}
