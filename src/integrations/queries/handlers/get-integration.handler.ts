import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { countDistinct, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { apiKeys, integrations } from "@/db/schemas";
import type { IntegrationDetail } from "@/integrations/models/integration";
import { integrationNotFound } from "@/integrations/models/integration-not-found";
import { selectIntegrationSummaries } from "@/integrations/models/integration-summaries";
import { GetIntegrationQuery } from "@/integrations/queries/impl/get-integration.query";

@QueryHandler(GetIntegrationQuery)
export class GetIntegrationHandler implements IQueryHandler<GetIntegrationQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ id }: GetIntegrationQuery): Promise<IntegrationDetail> {
    const [summary] = await selectIntegrationSummaries(this.db, eq(integrations.id, id));
    if (!summary) {
      throw integrationNotFound();
    }
    const [counts] = await this.db
      .select({
        activeKeyCount: sql<number>`count(*) filter (where ${apiKeys.revokedAt} is null)`.mapWith(
          Number,
        ),
        revokedKeyCount: sql<number>`count(${apiKeys.revokedAt})`.mapWith(Number),
        customerCount: countDistinct(apiKeys.customerId),
      })
      .from(apiKeys)
      .where(eq(apiKeys.integrationId, id));
    return { ...summary, ...counts };
  }
}
