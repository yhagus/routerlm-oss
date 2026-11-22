import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "@/routing/models/model.js";
import type { NewRoute } from "@/routing/schemas/routing.schema.js";

/** Adds the Route last and returns the Model as it now is. */
export class AddRouteCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly newRoute: NewRoute,
  ) {
    super();
  }
}
