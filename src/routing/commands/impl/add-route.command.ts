import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "@/routing/models/model";
import type { NewRoute } from "@/routing/schemas/routing.schema";

export class AddRouteCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly newRoute: NewRoute,
  ) {
    super();
  }
}
