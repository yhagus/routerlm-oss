import { Command } from "@nestjs/cqrs";
import type { UpstreamModel } from "@/upstream/models/upstream-model";
import type { NewUpstreamModel } from "@/upstream/schemas/upstream.schema";

export class CreateUpstreamModelCommand extends Command<UpstreamModel> {
  constructor(readonly newUpstreamModel: NewUpstreamModel) {
    super();
  }
}
