import { Command } from "@nestjs/cqrs";
import type { ModelDetail } from "../../models/model.js";
import type { RouteChanges } from "../../schemas/routing.schema.js";

/** Enables or disables the Route, or points it at another Upstream Model. */
export class UpdateRouteCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly routeId: string,
    readonly changes: RouteChanges,
  ) {
    super();
  }
}
