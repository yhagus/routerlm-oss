import { Query } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { IntegrationUsageLogPage } from '@/control-plane/models/integration-usage-log';
import type { UsageLogPageQuery } from '@/control-plane/schemas/usage-log.schema';

export class ListIntegrationUsageLogsQuery extends Query<IntegrationUsageLogPage> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly page: UsageLogPageQuery,
  ) {
    super();
  }
}
