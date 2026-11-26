import { Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import type { UsageLogDetail, UsageLogPage, UsageSummary } from './models/usage';
import { ListUsageLogsQuery } from './queries/impl/list-usage-logs.query';
import { ShowUsageLogQuery } from './queries/impl/show-usage-log.query';
import { SummarizeUsageQuery } from './queries/impl/summarize-usage.query';
import {
  type UsageFilter,
  usageFilterSchema,
  type UsagePageQuery,
  usagePageQuerySchema,
} from './schemas/usage.schema';

@DashboardController('usage')
export class UsageController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  listUsageLogs(
    @Query({ schema: usagePageQuerySchema }) query: UsagePageQuery,
  ): Promise<UsageLogPage> {
    return this.queryBus.execute(new ListUsageLogsQuery(query));
  }

  @Get('totals')
  summarizeUsage(@Query({ schema: usageFilterSchema }) filter: UsageFilter): Promise<UsageSummary> {
    return this.queryBus.execute(new SummarizeUsageQuery(filter));
  }

  @Get(':id')
  showUsageLog(@Param('id', ParseUUIDPipe) id: string): Promise<UsageLogDetail> {
    return this.queryBus.execute(new ShowUsageLogQuery(id));
  }
}
