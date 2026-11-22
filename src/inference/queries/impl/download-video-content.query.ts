import { Query } from "@nestjs/cqrs";
import type { InferenceCaller } from "@/inference/models/inference.js";

/** A completed Video Job's MP4, streamed through the gateway (`GET /v1/videos/{id}/content`, ADR 0028). */
export class DownloadVideoContentQuery extends Query<Response> {
  constructor(
    readonly videoId: string,
    readonly caller: InferenceCaller,
    /** Aborts the poll and the download when the client disconnects. */
    readonly clientSignal: AbortSignal,
  ) {
    super();
  }
}
