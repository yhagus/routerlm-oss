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
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { ModelDetail } from "./models.service.js";
import { RoutesService } from "./routes.service.js";
import {
  type NewRoute,
  newRouteSchema,
  type RouteChanges,
  routeChangesSchema,
  type RouteOrder,
  routeOrderSchema,
} from "./routing.schemas.js";

/** A Model's Routes. Every write answers with the whole Model, Routes in their new order. */
@DashboardController("models/:modelId")
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post("routes")
  addRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Body({ schema: newRouteSchema }) newRoute: NewRoute,
  ): Promise<ModelDetail> {
    return this.routes.addRoute(modelId, newRoute);
  }

  @Patch("routes/:routeId")
  updateRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Param("routeId", ParseUUIDPipe) routeId: string,
    @Body({ schema: routeChangesSchema }) changes: RouteChanges,
  ): Promise<ModelDetail> {
    return this.routes.updateRoute(modelId, routeId, changes);
  }

  @Delete("routes/:routeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRoute(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Param("routeId", ParseUUIDPipe) routeId: string,
  ): Promise<void> {
    return this.routes.removeRoute(modelId, routeId);
  }

  @Put("route-order")
  reorderRoutes(
    @Param("modelId", ParseUUIDPipe) modelId: string,
    @Body({ schema: routeOrderSchema }) order: RouteOrder,
  ): Promise<ModelDetail> {
    return this.routes.reorderRoutes(modelId, order);
  }
}
