import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';
import { ControlPlaneError } from '@/control-plane/models/control-plane-error';
import type { CustomerApiKeyPage } from '@/control-plane/models/customer-api-key';
import { selectCustomerApiKeys } from '@/control-plane/models/customer-api-keys';
import { ListCustomerApiKeysQuery } from '@/control-plane/queries/impl/list-customer-api-keys.query';

@QueryHandler(ListCustomerApiKeysQuery)
export class ListCustomerApiKeysHandler implements IQueryHandler<ListCustomerApiKeysQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ integration, page }: ListCustomerApiKeysQuery): Promise<CustomerApiKeyPage> {
    const keys = await selectCustomerApiKeys(this.db, integration.integrationId, {
      where: and(
        page.customerId === undefined ? undefined : eq(apiKeys.customerId, page.customerId),
        page.pageToken === undefined ? undefined : olderThan(lastKeyIdOf(page.pageToken)),
      ),
      limit: page.pageSize + 1,
    });
    const hasNextPage = keys.length > page.pageSize;
    const pageKeys = keys.slice(0, page.pageSize);
    return {
      keys: pageKeys,
      nextPageToken: hasNextPage ? pageTokenAfter(pageKeys[pageKeys.length - 1].id) : null,
    };
  }
}

function pageTokenAfter(lastKeyId: string): string {
  return Buffer.from(lastKeyId).toString('base64url');
}

function lastKeyIdOf(pageToken: string): string {
  const decoded = z.uuid().safeParse(Buffer.from(pageToken, 'base64url').toString());
  if (!decoded.success) {
    throw new ControlPlaneError('INVALID_ARGUMENT', 'Invalid pageToken');
  }
  return decoded.data;
}

function olderThan(lastKeyId: string): SQL {
  return sql`(${apiKeys.createdAt}, ${apiKeys.id}) < (select created_at, id from api_keys where id = ${lastKeyId})`;
}
