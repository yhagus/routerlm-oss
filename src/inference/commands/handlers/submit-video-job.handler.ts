import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { MediaClientContract, MediaReply } from "../../models/media-kind.js";
import type { SubmittedVideoJob, VideoGenerationRequest } from "../../models/video-generation.js";
import { openAiVideosClientContract } from "../../protocols/openai-videos/openai-videos-client-contract.js";
import { VideoHandles } from "../../providers/video-handles.js";
import { RunMediaInferenceCommand } from "../impl/run-media-inference.command.js";
import { SubmitVideoJobCommand } from "../impl/submit-video-job.command.js";

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
