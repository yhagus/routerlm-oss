import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ModelsController } from "./models.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { RoutesController } from "./routes.controller.js";

@Module({
  imports: [SnapshotModule],
  controllers: [ModelsController, RoutesController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class RoutingModule {}
