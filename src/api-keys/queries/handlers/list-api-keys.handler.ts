import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import type { ApiKeySummary } from "@/api-keys/models/api-key.js";
import { selectApiKeySummaries } from "@/api-keys/models/api-key-summaries.js";
import { ListApiKeysQuery } from "@/api-keys/queries/impl/list-api-keys.query.js";

@QueryHandler(ListApiKeysQuery)
export class ListApiKeysHandler implements IQueryHandler<ListApiKeysQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute({ filter }: ListApiKeysQuery): Promise<ApiKeySummary[]> {
    return selectApiKeySummaries(
      this.db,
      and(
        filter.integrationId === undefined
          ? undefined
          : eq(apiKeys.integrationId, filter.integrationId),
        filter.customerId === undefined ? undefined : eq(apiKeys.customerId, filter.customerId),
      ),
    );
  }
}
