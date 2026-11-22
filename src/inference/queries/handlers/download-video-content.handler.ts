import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { AttemptFailedError, gatewayErrorFor } from "@/inference/models/attempt-failure.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import { MediaFetcher } from "@/inference/providers/media-fetcher.js";
import { VideoTaskReader, videoNotFound } from "@/inference/providers/video-task-reader.js";
import { DownloadVideoContentQuery } from "@/inference/queries/impl/download-video-content.query.js";

const VIDEO_CONTENT_TYPE = "video/mp4";

@QueryHandler(DownloadVideoContentQuery)
export class DownloadVideoContentHandler implements IQueryHandler<DownloadVideoContentQuery> {
  constructor(
    private readonly tasks: VideoTaskReader,
    private readonly fetcher: MediaFetcher,
  ) {}

  /** Polls the task, then relays its video as it downloads: the upstream URL never reaches the client. */
  async execute({ videoId, caller, clientSignal }: DownloadVideoContentQuery): Promise<Response> {
    const { state } = await this.tasks.read(videoId, caller, clientSignal);
    if (state.status === "expired") {
      throw videoNotFound();
    }
    if (state.status !== "completed") {
      throw new GatewayError(
        "video_not_ready",
        `The video is ${state.status}, not completed`,
        "client",
      );
    }
    try {
      const video = await this.fetcher.stream(state.videoUrl, clientSignal);
      // Alibaba serves it as MP4; the host's own label is often a generic one.
      return new Response(video.body, {
        status: 200,
        headers: { "content-type": VIDEO_CONTENT_TYPE },
      });
    } catch (error) {
      // A network failure, a refused redirect or a private host: the client
      // hears the gateway's words, never the media host's.
      throw error instanceof AttemptFailedError
        ? gatewayErrorFor(error)
        : new GatewayError(
            "upstream_error",
            "The generated video could not be fetched",
            "upstream",
          );
    }
  }
}
