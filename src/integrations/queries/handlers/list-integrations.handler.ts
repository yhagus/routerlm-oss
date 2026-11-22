import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import type { IntegrationSummary } from "@/integrations/models/integration.js";
import { selectIntegrationSummaries } from "@/integrations/models/integration-summaries.js";
import { ListIntegrationsQuery } from "@/integrations/queries/impl/list-integrations.query.js";

@QueryHandler(ListIntegrationsQuery)
export class ListIntegrationsHandler implements IQueryHandler<ListIntegrationsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<IntegrationSummary[]> {
    return selectIntegrationSummaries(this.db);
  }
}
