import { Command } from "@nestjs/cqrs";
import type { Model } from "../../models/model.js";
import type { ModelChanges } from "../../schemas/routing.schema.js";

/** Renames, enables or disables the Model. */
export class UpdateModelCommand extends Command<Model> {
  constructor(
    readonly modelId: string,
    readonly changes: ModelChanges,
  ) {
    super();
  }
}
