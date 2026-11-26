import { Get, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import type { Overview } from "./models/overview";
import { ShowOverviewQuery } from "./queries/impl/show-overview.query";
import { type OverviewQuery, overviewQuerySchema } from "./schemas/overview-query.schema";

@DashboardController("overview")
export class OverviewController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  showOverview(@Query({ schema: overviewQuerySchema }) query: OverviewQuery): Promise<Overview> {
    return this.queryBus.execute(new ShowOverviewQuery(query.range));
  }
}
