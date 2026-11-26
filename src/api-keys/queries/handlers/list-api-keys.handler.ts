import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';
import type { ApiKeySummary } from '@/api-keys/models/api-key';
import { selectApiKeySummaries } from '@/api-keys/models/api-key-summaries';
import { ListApiKeysQuery } from '@/api-keys/queries/impl/list-api-keys.query';

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
