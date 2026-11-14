import {
  Body,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import { AddRouteCommand } from "./commands/impl/add-route.command.js";
import { RemoveRouteCommand } from "./commands/impl/remove-route.command.js";
import { ReorderRoutesCommand } from "./commands/impl/reorder-routes.command.js";
import { UpdateRouteCommand } from "./commands/impl/update-route.command.js";
import type { ModelDetail } from "./models/model.js";
import {
  type NewRoute,
  newRouteSchema,
  type RouteChanges,
  routeChangesSchema,
  type RouteOrder,
  routeOrderSchema,
} from "./schemas/routing.schema.js";

/** A Model's Routes. Every write answers with the whole Model, Routes in their new order. */
@DashboardController("models/:modelId")
export class RoutesController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("routes")
  addRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Body({ schema: newRouteSchema }) newRoute: NewRoute,
  ): Promise<ModelDetail> {
    return this.commandBus.execute(new AddRouteCommand(modelId, newRoute));
  }

  @Patch("routes/:routeId")
  updateRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Param("routeId", ParseUUIDPipe) routeId: string,
    @Body({ schema: routeChangesSchema }) changes: RouteChanges,
  ): Promise<ModelDetail> {
    return this.commandBus.execute(new UpdateRouteCommand(modelId, routeId, changes));
  }

  @Delete("routes/:routeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Param("routeId", ParseUUIDPipe) routeId: string,
  ): Promise<void> {
    return this.commandBus.execute(new RemoveRouteCommand(modelId, routeId));
  }

  @Put("route-order")
  reorderRoutes(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Body({ schema: routeOrderSchema }) order: RouteOrder,
  ): Promise<ModelDetail> {
    return this.commandBus.execute(new ReorderRoutesCommand(modelId, order));
  }
}
