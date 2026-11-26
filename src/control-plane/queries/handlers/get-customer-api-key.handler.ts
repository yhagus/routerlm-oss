import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import type { CustomerApiKey } from '@/control-plane/models/customer-api-key';
import { findCustomerApiKey } from '@/control-plane/models/customer-api-keys';
import { GetCustomerApiKeyQuery } from '@/control-plane/queries/impl/get-customer-api-key.query';

@QueryHandler(GetCustomerApiKeyQuery)
export class GetCustomerApiKeyHandler implements IQueryHandler<GetCustomerApiKeyQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute({ integration, id }: GetCustomerApiKeyQuery): Promise<CustomerApiKey> {
    return findCustomerApiKey(this.db, integration.integrationId, id);
  }
}
