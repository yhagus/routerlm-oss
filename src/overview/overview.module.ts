import { Module } from "@nestjs/common";
import { OverviewController } from "./overview.controller.js";
import { OverviewService } from "./overview.service.js";

/** The Overview page's API: Usage Logs aggregated over time. */
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
