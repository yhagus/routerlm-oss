import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "@/routing/models/model";
import type { RouteChanges } from "@/routing/schemas/routing.schema";

export class UpdateRouteCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly routeId: string,
    readonly changes: RouteChanges,
  ) {
    super();
  }
}
