import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "../../models/model.js";
import type { RouteOrder } from "../../schemas/routing.schema.js";

/** Saves the new order as each Route's priority: the first listed gets 0 and is tried first. */
export class ReorderRoutesCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly order: RouteOrder,
  ) {
    super();
  }
}
