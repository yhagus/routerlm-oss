import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import {
  type ListModelsResponseJson,
  listModelsResponseJsonOf,
} from "@/control-plane/models/proto-json.js";
import { ListIntegrationModelsQuery } from "@/control-plane/queries/impl/list-integration-models.query.js";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import { integrationNotFound } from "@/integrations/models/integration-not-found.js";
import { ListIntegrationOfferedModelsQuery } from "@/integrations/queries/impl/list-integration-offered-models.query.js";

@QueryHandler(ListIntegrationOfferedModelsQuery)
export class ListIntegrationOfferedModelsHandler implements IQueryHandler<ListIntegrationOfferedModelsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({
    integrationId,
  }: ListIntegrationOfferedModelsQuery): Promise<ListModelsResponseJson> {
    const [integration] = await this.db
      .select({
        integrationId: integrations.id,
        integrationName: integrations.name,
        allowedModelIds: integrations.allowedModelIds,
      })
      .from(integrations)
      .where(eq(integrations.id, integrationId));
    if (!integration) {
      throw integrationNotFound();
    }
    const models = await this.queryBus.execute(new ListIntegrationModelsQuery(integration));
    return listModelsResponseJsonOf(models);
  }
}
