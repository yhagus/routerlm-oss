import { Module } from "@nestjs/common";
import { OverviewController } from "./overview.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

@Module({
  controllers: [OverviewController],
  providers: [...QueryHandlers],
})
export class OverviewModule {}
