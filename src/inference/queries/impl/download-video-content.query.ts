import { Query } from "@nestjs/cqrs";
import type { InferenceCaller } from "@/inference/models/inference";

export class DownloadVideoContentQuery extends Query<Response> {
  constructor(
    readonly videoId: string,
    readonly caller: InferenceCaller,
    readonly clientSignal: AbortSignal,
  ) {
    super();
  }
}
