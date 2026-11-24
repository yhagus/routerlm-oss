import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "@/routing/models/model.js";
import type { RouteOrder } from "@/routing/schemas/routing.schema.js";

export class ReorderRoutesCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly order: RouteOrder,
  ) {
    super();
  }
}
