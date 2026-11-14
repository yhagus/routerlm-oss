import { Module } from "@nestjs/common";
import { OverviewController } from "./overview.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/** The Overview page's API: Usage Logs aggregated over time. */
@Module({
  controllers: [OverviewController],
  providers: [...QueryHandlers],
})
export class OverviewModule {}
