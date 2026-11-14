import { Module } from "@nestjs/common";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { ModelsController } from "./models.controller.js";
import { ModelsService } from "./models.service.js";
import { RoutesController } from "./routes.controller.js";
import { RoutesService } from "./routes.service.js";

/** Dashboard management of Models and their Routes. */
@Module({
  imports: [SnapshotModule],
  controllers: [ModelsController, RoutesController],
  providers: [ModelsService, RoutesService],
})
export class RoutingModule {}
