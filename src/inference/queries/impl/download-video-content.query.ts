import { Query } from "@nestjs/cqrs";
import type { InferenceCaller } from "@/inference/models/inference.js";

export class DownloadVideoContentQuery extends Query<Response> {
  constructor(
    readonly videoId: string,
    readonly caller: InferenceCaller,
    readonly clientSignal: AbortSignal,
  ) {
    super();
  }
}
