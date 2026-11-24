import { Get, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { Overview } from "./models/overview.js";
import { ShowOverviewQuery } from "./queries/impl/show-overview.query.js";
import { type OverviewQuery, overviewQuerySchema } from "./schemas/overview-query.schema.js";

@DashboardController("overview")
export class OverviewController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  showOverview(@Query({ schema: overviewQuerySchema }) query: OverviewQuery): Promise<Overview> {
    return this.queryBus.execute(new ShowOverviewQuery(query.range));
  }
}
