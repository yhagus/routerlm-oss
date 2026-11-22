import { Command } from "@nestjs/cqrs";
import type { UpstreamModel } from "@/upstream/models/upstream-model.js";
import type { UpstreamModelChanges } from "@/upstream/schemas/upstream.schema.js";

/** Edits Capabilities, limits and prices, or enables or disables the Upstream Model. */
export class UpdateUpstreamModelCommand extends Command<UpstreamModel> {
  constructor(
    readonly upstreamModelId: string,
    readonly changes: UpstreamModelChanges,
  ) {
    super();
  }
}
