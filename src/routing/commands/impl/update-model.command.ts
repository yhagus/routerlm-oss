import { Command } from "@nestjs/cqrs";
import type { Model } from "@/routing/models/model.js";
import type { ModelChanges } from "@/routing/schemas/routing.schema.js";

export class UpdateModelCommand extends Command<Model> {
  constructor(
    readonly modelId: string,
    readonly changes: ModelChanges,
  ) {
    super();
  }
}
