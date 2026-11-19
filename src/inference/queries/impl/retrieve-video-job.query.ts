import { Query } from "@nestjs/cqrs";
import type { InferenceCaller } from "../../models/inference.js";

/** A Video Job's video object with its current status (`GET /v1/videos/{id}`). */
export class RetrieveVideoJobQuery extends Query<unknown> {
  constructor(
    readonly videoId: string,
    readonly caller: InferenceCaller,
    /** Aborts the upstream call when the client disconnects. */
    readonly clientSignal: AbortSignal,
  ) {
    super();
  }
}
