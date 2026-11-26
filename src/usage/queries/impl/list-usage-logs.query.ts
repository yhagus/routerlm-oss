import { Query } from '@nestjs/cqrs';
import type { UsageLogPage } from '@/usage/models/usage';
import type { UsagePageQuery } from '@/usage/schemas/usage.schema';

export class ListUsageLogsQuery extends Query<UsageLogPage> {
  constructor(readonly pageQuery: UsagePageQuery) {
    super();
  }
}
