import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller.js";
import { ModelsService } from "./models.service.js";
import { RoutesController } from "./routes.controller.js";
import { RoutesService } from "./routes.service.js";
import { RoutingChangeSignal } from "./routing-change-signal.js";

/** Dashboard management of Models and their Routes. */
@Module({
  controllers: [ModelsController, RoutesController],
  providers: [ModelsService, RoutesService, RoutingChangeSignal],
  // The snapshot refresh hooks into the signal.
  exports: [RoutingChangeSignal],
})
export class RoutingModule {}
