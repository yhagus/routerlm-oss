import { Command } from "@nestjs/cqrs";
import type { Model } from "@/routing/models/model";
import type { ModelChanges } from "@/routing/schemas/routing.schema";

export class UpdateModelCommand extends Command<Model> {
  constructor(
    readonly modelId: string,
    readonly changes: ModelChanges,
  ) {
    super();
  }
}
