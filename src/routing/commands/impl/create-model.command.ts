import { Command } from "@nestjs/cqrs";
import type { Model } from "../../models/model.js";
import type { NewModel } from "../../schemas/routing.schema.js";

export class CreateModelCommand extends Command<Model> {
  constructor(readonly newModel: NewModel) {
    super();
  }
}
