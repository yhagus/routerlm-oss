import { Command } from "@nestjs/cqrs";
import type { UpstreamModel } from "@/upstream/models/upstream-model.js";
import type { UpstreamModelChanges } from "@/upstream/schemas/upstream.schema.js";

export class UpdateUpstreamModelCommand extends Command<UpstreamModel> {
  constructor(
    readonly upstreamModelId: string,
    readonly changes: UpstreamModelChanges,
  ) {
    super();
  }
}
