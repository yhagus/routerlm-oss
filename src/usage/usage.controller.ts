import { Get, Query } from "@nestjs/common";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { UsageLogPage, UsageTotals } from "./usage.js";
import {
  type UsageFilter,
  usageFilterSchema,
  type UsagePageQuery,
  usagePageQuerySchema,
} from "./usage.schemas.js";
import { UsageService } from "./usage.service.js";

/** The Usage page: Usage Logs and their totals, filtered. Only a User's session gets in. */
@DashboardController("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  listUsageLogs(
    @Query({ schema: usagePageQuerySchema }) query: UsagePageQuery,
  ): Promise<UsageLogPage> {
    return this.usage.listUsageLogs(query);
  }

  /** Totals by Model and by API Key over the same filters as the list. */
  @Get("totals")
  totalUsage(@Query({ schema: usageFilterSchema }) filter: UsageFilter): Promise<UsageTotals> {
    return this.usage.totalUsage(filter);
  }
}
