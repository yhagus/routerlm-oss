import { Get, Query } from "@nestjs/common";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { Overview } from "./overview.js";
import { type OverviewQuery, overviewQuerySchema } from "./overview.schemas.js";
import { OverviewService } from "./overview.service.js";

/** The dashboard's landing page: gateway traffic over time. Only a User's session gets in. */
@DashboardController("overview")
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  showOverview(@Query({ schema: overviewQuerySchema }) query: OverviewQuery): Promise<Overview> {
    return this.overview.overviewOf(query.range);
  }
}
