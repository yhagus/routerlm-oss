import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { MediaClientContract, MediaReply } from "@/inference/models/media-kind.js";
import type {
  SubmittedVideoJob,
  VideoGenerationRequest,
} from "@/inference/models/video-generation.js";
import { openAiVideosClientContract } from "@/inference/protocols/openai-videos/openai-videos-client-contract.js";
import { VideoHandles } from "@/inference/providers/video-handles.js";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import { SubmitVideoJobCommand } from "@/inference/commands/impl/submit-video-job.command.js";

@CommandHandler(SubmitVideoJobCommand)
export class SubmitVideoJobHandler implements ICommandHandler<SubmitVideoJobCommand> {
  private readonly contract: MediaClientContract<VideoGenerationRequest, SubmittedVideoJob>;

  constructor(
    private readonly commandBus: CommandBus,
    handles: VideoHandles,
  ) {
    this.contract = openAiVideosClientContract(handles);
  }

  execute({
    body,
    caller,
    connection,
    onUsage,
    target,
  }: SubmitVideoJobCommand): Promise<MediaReply> {
    return this.commandBus.execute(
      new RunMediaInferenceCommand(this.contract, body, caller, connection, onUsage, target),
    );
  }
}
