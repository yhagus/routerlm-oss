import { Query } from "@nestjs/cqrs";
import type { InferenceCaller } from "@/inference/models/inference.js";

export class RetrieveVideoJobQuery extends Query<unknown> {
  constructor(
    readonly videoId: string,
    readonly caller: InferenceCaller,
    readonly clientSignal: AbortSignal,
  ) {
    super();
  }
}
