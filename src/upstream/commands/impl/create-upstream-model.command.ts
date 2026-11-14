import { Command } from "@nestjs/cqrs";
import type { UpstreamModel } from "../../models/upstream-model.js";
import type { NewUpstreamModel } from "../../schemas/upstream.schema.js";

export class CreateUpstreamModelCommand extends Command<UpstreamModel> {
  constructor(readonly newUpstreamModel: NewUpstreamModel) {
    super();
  }
}
