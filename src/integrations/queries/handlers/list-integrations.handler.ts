import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import type { IntegrationSummary } from '@/integrations/models/integration';
import { selectIntegrationSummaries } from '@/integrations/models/integration-summaries';
import { ListIntegrationsQuery } from '@/integrations/queries/impl/list-integrations.query';

@QueryHandler(ListIntegrationsQuery)
export class ListIntegrationsHandler implements IQueryHandler<ListIntegrationsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<IntegrationSummary[]> {
    return selectIntegrationSummaries(this.db);
  }
}
