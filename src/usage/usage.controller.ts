import { Get, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { UsageLogPage, UsageSummary } from "./models/usage.js";
import { ListUsageLogsQuery } from "./queries/impl/list-usage-logs.query.js";
import { SummarizeUsageQuery } from "./queries/impl/summarize-usage.query.js";
import {
  type UsageFilter,
  usageFilterSchema,
  type UsagePageQuery,
  usagePageQuerySchema,
} from "./schemas/usage.schema.js";

/** The Usage page: Usage Logs and their summary, filtered. Only a User's session gets in. */
@DashboardController("usage")
export class UsageController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  listUsageLogs(
    @Query({ schema: usagePageQuerySchema }) query: UsagePageQuery,
  ): Promise<UsageLogPage> {
    return this.queryBus.execute(new ListUsageLogsQuery(query));
  }

  /** One summary over the same filters as the list. */
  @Get("totals")
  summarizeUsage(@Query({ schema: usageFilterSchema }) filter: UsageFilter): Promise<UsageSummary> {
    return this.queryBus.execute(new SummarizeUsageQuery(filter));
  }
}
