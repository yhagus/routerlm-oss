import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { videoObjectOf } from "@/inference/protocols/openai-videos/openai-videos-client-contract";
import { VideoTaskReader } from "@/inference/providers/video-task-reader";
import { RetrieveVideoJobQuery } from "@/inference/queries/impl/retrieve-video-job.query";

@QueryHandler(RetrieveVideoJobQuery)
export class RetrieveVideoJobHandler implements IQueryHandler<RetrieveVideoJobQuery> {
  constructor(private readonly tasks: VideoTaskReader) {}

  async execute({ videoId, caller, clientSignal }: RetrieveVideoJobQuery): Promise<unknown> {
    const { handle, state } = await this.tasks.read(videoId, caller, clientSignal);
    return videoObjectOf(videoId, handle, state);
  }
}
