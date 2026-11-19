import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { videoObjectOf } from "../../protocols/openai-videos/openai-videos-client-contract.js";
import { VideoTaskReader } from "../../providers/video-task-reader.js";
import { RetrieveVideoJobQuery } from "../impl/retrieve-video-job.query.js";

@QueryHandler(RetrieveVideoJobQuery)
export class RetrieveVideoJobHandler implements IQueryHandler<RetrieveVideoJobQuery> {
  constructor(private readonly tasks: VideoTaskReader) {}

  async execute({ videoId, caller, clientSignal }: RetrieveVideoJobQuery): Promise<unknown> {
    const { handle, state } = await this.tasks.read(videoId, caller, clientSignal);
    return videoObjectOf(videoId, handle, state);
  }
}
