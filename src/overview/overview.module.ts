import { Module } from "@nestjs/common";
import { OverviewController } from "./overview.controller";
import { QueryHandlers } from "./queries/handlers";

@Module({
  controllers: [OverviewController],
  providers: [...QueryHandlers],
})
export class OverviewModule {}
