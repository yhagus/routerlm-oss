import { Command } from "@nestjs/cqrs";
import type { Model } from "@/routing/models/model.js";
import type { NewModel } from "@/routing/schemas/routing.schema.js";

export class CreateModelCommand extends Command<Model> {
  constructor(readonly newModel: NewModel) {
    super();
  }
}
