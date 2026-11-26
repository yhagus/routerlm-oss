import { Command } from "@nestjs/cqrs";
import type { UpstreamModel } from "@/upstream/models/upstream-model";
import type { UpstreamModelChanges } from "@/upstream/schemas/upstream.schema";

export class UpdateUpstreamModelCommand extends Command<UpstreamModel> {
  constructor(
    readonly upstreamModelId: string,
    readonly changes: UpstreamModelChanges,
  ) {
    super();
  }
}
